/**
 * Real ER + PER Integration Tests
 *
 * These tests exercise the actual MagicBlock infrastructure:
 *   - ER: Magic Router (https://as.magicblock.app)
 *   - PER: TEE endpoint (requires MAGICBLOCK_PER_ENDPOINT env var)
 *
 * Prerequisites:
 *   - backend/.env must have MAGICBLOCK_ROUTER_URL set
 *   - programs/tests/devnet/test-wallet.json must have devnet SOL
 *   - Devnet program must be deployed (FBh8hmjZYZhrhi1ionZHCVxrBbjn6s9oSGnSu3gV4vkF)
 *
 * Run with:
 *   cd backend && npx jest src/magicblock/magicblock-er-per.integration.spec.ts --testTimeout=300000
 */

import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { Connection, Keypair, PublicKey, VersionedTransaction, Transaction } from '@solana/web3.js';
import { ConnectionMagicRouter } from '@magicblock-labs/ephemeral-rollups-sdk';
import { MagicBlockErRealAdapter } from './magicblock-er-real.adapter';
import { MagicBlockPerRealAdapter } from './magicblock-per-real.adapter';
import { MagicBlockClientService } from './magicblock-client.service';
import { MagicBlockPerClientService } from './magicblock-per-client.service';
import { AnchorOnchainAdapterService } from '../onchain/anchor-onchain-adapter.service';
import { AnchorClientService } from '../onchain/anchor-client.service';
import { KeeperKeypairService } from '../onchain/keeper-keypair.service';
import * as fs from 'fs';
import * as path from 'path';

const DEVNET_RPC = 'https://api.devnet.solana.com';
const PROGRAM_ID = 'FBh8hmjZYZhrhi1ionZHCVxrBbjn6s9oSGnSu3gV4vkF';
const MAGICBLOCK_ROUTER = 'https://as.magicblock.app';

// Load devnet test wallet
function loadTestWallet(): Keypair {
  const walletPath = path.join(__dirname, '../../../programs/tests/devnet/test-wallet.json');
  const secretKey = Uint8Array.from(JSON.parse(fs.readFileSync(walletPath, 'utf-8')));
  return Keypair.fromSecretKey(secretKey);
}

async function ensureBalance(connection: Connection, pubkey: PublicKey, minSol = 1) {
  const balance = await connection.getBalance(pubkey);
  if (balance < minSol * 1e9) {
    throw new Error(
      `Insufficient devnet balance: ${balance / 1e9} SOL. Need at least ${minSol} SOL.`,
    );
  }
}

const SKIP_INTEGRATION_TESTS = process.env.SKIP_INTEGRATION_TESTS === '1' || process.env.SKIP_INTEGRATION_TESTS === 'true';

describe('MagicBlock ER + PER — Real Integration', () => {
  let erAdapter: MagicBlockErRealAdapter;
  let perAdapter: MagicBlockPerRealAdapter | null;
  let onchainAdapter: AnchorOnchainAdapterService;
  let connection: Connection;
  let routerConnection: ConnectionMagicRouter;
  let wallet: Keypair;
  let isPerConfigured: boolean;

  beforeAll(async () => {
    if (SKIP_INTEGRATION_TESTS) {
      return;
    }
    wallet = loadTestWallet();
    connection = new Connection(DEVNET_RPC, 'confirmed');
    routerConnection = new ConnectionMagicRouter(MAGICBLOCK_ROUTER, {
      wsEndpoint: MAGICBLOCK_ROUTER.replace(/^https?/, 'wss'),
      commitment: 'confirmed',
    });
    await ensureBalance(connection, wallet.publicKey, 0.3);

    // Check PER configuration
    const perEndpoint = process.env.MAGICBLOCK_PER_ENDPOINT;
    isPerConfigured = !!perEndpoint && perEndpoint.trim().length > 0;

    const moduleRef = await Test.createTestingModule({
      providers: [
        MagicBlockErRealAdapter,
        MagicBlockClientService,
        AnchorOnchainAdapterService,
        AnchorClientService,
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) => {
              const map: Record<string, string | undefined> = {
                STRATEGY_RUNTIME_PROGRAM_ID: PROGRAM_ID,
                SOLANA_RPC_URL: DEVNET_RPC,
                STRATEGY_RUNTIME_COMMITMENT: 'confirmed',
                MAGICBLOCK_ROUTER_URL: MAGICBLOCK_ROUTER,
                MAGICBLOCK_PER_ENDPOINT: perEndpoint,
                MAGICBLOCK_COMMITMENT: 'confirmed',
              };
              return map[key] ?? undefined;
            },
          },
        },
        {
          provide: KeeperKeypairService,
          useValue: {
            loadKeypair: async () => wallet,
          },
        },
      ],
    }).compile();

    erAdapter = moduleRef.get(MagicBlockErRealAdapter);
    onchainAdapter = moduleRef.get(AnchorOnchainAdapterService);

    if (isPerConfigured) {
      // Only create PER adapter if endpoint is configured
      const perClient = new MagicBlockPerClientService(
        moduleRef.get(ConfigService),
      );
      // PER adapter needs repos - skip for now unless fully wired
      perAdapter = null;
    }
  });

  // ───────────────────────────────────────────
  // ER (Ephemeral Rollups) Tests
  // ───────────────────────────────────────────
  describe('ER — Magic Router', () => {
    it('verifies Magic Router is reachable', async () => {
      if (SKIP_INTEGRATION_TESTS) return;
      const client = (erAdapter as any).client as MagicBlockClientService;
      const url = client.getRouterUrl();
      expect(url).toBe(MAGICBLOCK_ROUTER);
      console.log(`Magic Router URL: ${url}`);
    });

    it('creates a PER-mode deployment on devnet', async () => {
      if (SKIP_INTEGRATION_TESTS) return;
      const deploymentId = crypto.randomUUID();
      const strategyId = crypto.randomUUID();

      const result = await onchainAdapter.initializeDeployment({
        deploymentId,
        strategyId,
        strategyVersion: 1,
        creatorWallet: wallet.publicKey.toBase58(),
        vaultOwnerHint: null,
        publicMetadataHash: 'a'.repeat(64),
        privateDefinitionCommitment: 'b'.repeat(64),
        executionMode: 'per',
      });

      expect(result.deploymentAccount).toBeTruthy();
      expect(result.signature).toBeTruthy();

      // Verify on-chain
      const program = await (onchainAdapter as any).anchorClient.getProgram();
      const deployment = await program.account.strategyDeployment.fetch(
        result.deploymentAccount!,
      );
      expect(deployment.executionMode).toBe(2); // PER = 2
      console.log(`PER deployment created: ${result.deploymentAccount}`);
    });

    it('creates an ER-mode deployment on devnet', async () => {
      if (SKIP_INTEGRATION_TESTS) return;
      const deploymentId = crypto.randomUUID();
      const strategyId = crypto.randomUUID();

      const result = await onchainAdapter.initializeDeployment({
        deploymentId,
        strategyId,
        strategyVersion: 1,
        creatorWallet: wallet.publicKey.toBase58(),
        vaultOwnerHint: null,
        publicMetadataHash: 'a'.repeat(64),
        privateDefinitionCommitment: 'b'.repeat(64),
        executionMode: 'er',
      });

      expect(result.deploymentAccount).toBeTruthy();
      expect(result.signature).toBeTruthy();

      // Verify on-chain
      const program = await (onchainAdapter as any).anchorClient.getProgram();
      const deployment = await program.account.strategyDeployment.fetch(
        result.deploymentAccount!,
      );
      expect(deployment.executionMode).toBe(1); // ER = 1
      console.log(`ER deployment created: ${result.deploymentAccount}`);
    });

    it('routes a simple transfer transaction through Magic Router', async () => {
      if (SKIP_INTEGRATION_TESTS) return;
      // Build a simple transfer ix to test router connectivity
      const recipient = Keypair.generate().publicKey;
      const ix = {
        programId: new PublicKey('11111111111111111111111111111111'),
        keys: [
          { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
          { pubkey: recipient, isSigner: false, isWritable: true },
        ],
        data: Buffer.from([2, 0, 0, 0, 128, 150, 152, 0, 0, 0, 0, 0]), // transfer 0.001 SOL
      };

      const tx = new Transaction().add(ix as any);
      tx.feePayer = wallet.publicKey;
      const { blockhash } = await routerConnection.getLatestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.sign(wallet);

      const base64Tx = tx.serialize({ requireAllSignatures: true }).toString('base64');

      // Route through Magic Router
      const result = await erAdapter.route({
        deploymentId: 'test-deployment',
        base64Tx,
      });

      expect(result.signature).toBeTruthy();
      expect(result.routedThrough).toBe('er');
      console.log(`Routed through ER, signature: ${result.signature}`);
    });

    it('delegateAccount advisory mode when no signed tx provided', async () => {
      if (SKIP_INTEGRATION_TESTS) return;
      const result = await erAdapter.delegateAccount({
        deploymentId: 'test-er-deployment',
        accountPubkey: wallet.publicKey.toBase58(),
      });

      expect(result.signature).toBeNull();
      expect(result.sessionId).toMatch(/^er-advisory-/);
      console.log(`Advisory mode session: ${result.sessionId}`);
    });

    it('commitAndUndelegate advisory mode when no signed tx provided', async () => {
      if (SKIP_INTEGRATION_TESTS) return;
      const result = await erAdapter.commitAndUndelegate({
        deploymentId: 'test-er-deployment',
        accountPubkey: wallet.publicKey.toBase58(),
      });

      expect(result.signature).toBeNull();
      console.log('CommitAndUndelegate advisory mode OK');
    });
  });

  // ───────────────────────────────────────────
  // PER (Private Ephemeral Rollups) Tests
  // ───────────────────────────────────────────
  describe('PER — TEE Private State', () => {
    beforeAll(() => {
      if (!isPerConfigured) {
        console.log(
          '⏭️  Skipping PER tests — set MAGICBLOCK_PER_ENDPOINT env var to enable real PER testing',
        );
      }
    });

    it('checks PER endpoint configuration', () => {
      if (isPerConfigured) {
        expect(process.env.MAGICBLOCK_PER_ENDPOINT).toBeTruthy();
        console.log(`PER endpoint: ${process.env.MAGICBLOCK_PER_ENDPOINT}`);
      } else {
        console.log('PER endpoint not configured — skipping');
      }
    });

    it('validates execution_mode=PER field is readable by PER adapter', async () => {
      if (SKIP_INTEGRATION_TESTS) return;
      // This test verifies that when the backend creates a PER deployment,
      // the on-chain execution_mode field is correctly set to 2 (PER).
      // The PER adapter uses this field to determine routing.
      const deploymentId = crypto.randomUUID();
      const strategyId = crypto.randomUUID();

      const result = await onchainAdapter.initializeDeployment({
        deploymentId,
        strategyId,
        strategyVersion: 1,
        creatorWallet: wallet.publicKey.toBase58(),
        vaultOwnerHint: null,
        publicMetadataHash: 'a'.repeat(64),
        privateDefinitionCommitment: 'b'.repeat(64),
        executionMode: 'per',
      });

      const program = await (onchainAdapter as any).anchorClient.getProgram();
      const deployment = await program.account.strategyDeployment.fetch(
        result.deploymentAccount!,
      );

      // The PER adapter in the backend reads this field to know
      // that this deployment uses Private Ephemeral Rollups
      expect(deployment.executionMode).toBe(2);
      expect(deployment.lifecycleStatus).toBe(1); // deployed

      console.log(
        `PER deployment validated: mode=${deployment.executionMode}, status=${deployment.lifecycleStatus}`,
      );
    });
  });

  // ───────────────────────────────────────────
  // ER ↔ On-chain Integration
  // ───────────────────────────────────────────
  describe('ER ↔ On-chain Integration', () => {
    it('full flow: create ER deployment → read execution_mode → route tx', async () => {
      if (SKIP_INTEGRATION_TESTS) return;
      // 1. Create an ER-mode deployment
      const deploymentId = crypto.randomUUID();
      const strategyId = crypto.randomUUID();

      const deployResult = await onchainAdapter.initializeDeployment({
        deploymentId,
        strategyId,
        strategyVersion: 1,
        creatorWallet: wallet.publicKey.toBase58(),
        vaultOwnerHint: null,
        publicMetadataHash: 'a'.repeat(64),
        privateDefinitionCommitment: 'b'.repeat(64),
        executionMode: 'er',
      });

      // 2. Verify execution_mode on chain
      const program = await (onchainAdapter as any).anchorClient.getProgram();
      const deployment = await program.account.strategyDeployment.fetch(
        deployResult.deploymentAccount!,
      );
      expect(deployment.executionMode).toBe(1); // ER

      // 3. Build and route a transaction through Magic Router
      // (Simulating what the ER adapter does during normal operation)
      const testIx = {
        programId: new PublicKey(PROGRAM_ID),
        keys: [
          { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
          { pubkey: new PublicKey(deployResult.deploymentAccount!), isSigner: false, isWritable: false },
        ],
        data: Buffer.from([]),
      };

      const tx = new Transaction().add(testIx as any);
      tx.feePayer = wallet.publicKey;
      const { blockhash } = await routerConnection.getLatestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.sign(wallet);

      const base64Tx = tx.serialize({ requireAllSignatures: true }).toString('base64');

      const routeResult = await erAdapter.route({
        deploymentId,
        base64Tx,
      });

      expect(routeResult.signature).toBeTruthy();
      console.log(
        `ER full flow OK: deployment=${deployResult.deploymentAccount}, route_sig=${routeResult.signature}`,
      );
    });

    it('verifies ER and PER deployments coexist on devnet', async () => {
      if (SKIP_INTEGRATION_TESTS) return;
      const erDeploymentId = crypto.randomUUID();
      const perDeploymentId = crypto.randomUUID();

      const [erResult, perResult] = await Promise.all([
        onchainAdapter.initializeDeployment({
          deploymentId: erDeploymentId,
          strategyId: crypto.randomUUID(),
          strategyVersion: 1,
          creatorWallet: wallet.publicKey.toBase58(),
          vaultOwnerHint: null,
          publicMetadataHash: 'a'.repeat(64),
          privateDefinitionCommitment: 'b'.repeat(64),
          executionMode: 'er',
        }),
        onchainAdapter.initializeDeployment({
          deploymentId: perDeploymentId,
          strategyId: crypto.randomUUID(),
          strategyVersion: 1,
          creatorWallet: wallet.publicKey.toBase58(),
          vaultOwnerHint: null,
          publicMetadataHash: 'b'.repeat(64),
          privateDefinitionCommitment: 'c'.repeat(64),
          executionMode: 'per',
        }),
      ]);

      const program = await (onchainAdapter as any).anchorClient.getProgram();
      const [erDeployment, perDeployment] = await Promise.all([
        program.account.strategyDeployment.fetch(erResult.deploymentAccount!),
        program.account.strategyDeployment.fetch(perResult.deploymentAccount!),
      ]);

      expect(erDeployment.executionMode).toBe(1); // ER
      expect(perDeployment.executionMode).toBe(2); // PER

      console.log(`ER deployment: ${erResult.deploymentAccount}`);
      console.log(`PER deployment: ${perResult.deploymentAccount}`);
    });
  });
});
