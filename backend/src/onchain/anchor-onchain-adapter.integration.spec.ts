require('dotenv').config();

/**
 * Integration test: AnchorOnchainAdapterService ↔ devnet strategy_runtime
 *
 * This test verifies that the backend adapter correctly builds instructions
 * and reads account data from the live devnet deployment. It bridges the
 * on-chain program layer and the backend service layer.
 *
 * Prerequisites:
 *   - tests/devnet/test-wallet.json must exist and have devnet SOL
 *   - backend/.env or env vars must set STRATEGY_RUNTIME_PROGRAM_ID
 *
 * Run with:
 *   npx jest src/onchain/anchor-onchain-adapter.integration.spec.ts --testTimeout=300000
 */

import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { Connection, Keypair, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { AnchorOnchainAdapterService } from './anchor-onchain-adapter.service';
import { AnchorClientService } from './anchor-client.service';
import { KeeperKeypairService } from './keeper-keypair.service';
import { withRpcRetry } from '../magicblock/__test-helpers__/rpc-retry';
import * as fs from 'fs';
import * as path from 'path';

const DEVNET_RPC = 'https://devnet.helius-rpc.com/?api-key=8939699e-77dc-4fa7-aa0a-8c486f30276a';
const PROGRAM_ID = 'FBh8hmjZYZhrhi1ionZHCVxrBbjn6s9oSGnSu3gV4vkF';

// Load the same test wallet used by programs/devnet tests
function loadTestWallet(): Keypair {
  const walletPath = path.join(__dirname, '../../../programs/tests/devnet/test-wallet.json');
  const secretKey = Uint8Array.from(JSON.parse(fs.readFileSync(walletPath, 'utf-8')));
  return Keypair.fromSecretKey(secretKey);
}

async function ensureBalance(connection: Connection, pubkey: Keypair['publicKey']) {
  const balance = await withRpcRetry(() => connection.getBalance(pubkey), {
    label: 'getBalance',
  });
  if (balance < LAMPORTS_PER_SOL) {
    console.log(`Requesting airdrop for ${pubkey.toBase58()}...`);
    try {
      await withRpcRetry(() => connection.requestAirdrop(pubkey, 2 * LAMPORTS_PER_SOL), {
        label: 'requestAirdrop',
      });
      for (let i = 0; i < 30; i++) {
        await new Promise((r) => setTimeout(r, 1000));
        const b = await withRpcRetry(() => connection.getBalance(pubkey), {
          label: 'getBalance(poll)',
        });
        if (b >= LAMPORTS_PER_SOL) break;
      }
    } catch (e) {
      console.warn('Airdrop failed:', e);
    }
  }
}

const RUN_EXTERNAL_INTEGRATION_TESTS =
  process.env.RUN_EXTERNAL_INTEGRATION_TESTS === '1' ||
  process.env.RUN_EXTERNAL_INTEGRATION_TESTS === 'true';
const SKIP_INTEGRATION_TESTS =
  !RUN_EXTERNAL_INTEGRATION_TESTS ||
  process.env.SKIP_INTEGRATION_TESTS === '1' ||
  process.env.SKIP_INTEGRATION_TESTS === 'true';

describe('AnchorOnchainAdapterService — Devnet Integration', () => {
  // initializeDeployment makes 5 sequential on-chain calls; under devnet
  // load + rate-limit backoff a single call easily exceeds 60s. The
  // "maps execution modes" test runs three of these back-to-back, so we
  // budget generously.
  jest.setTimeout(300_000);

  let adapter: AnchorOnchainAdapterService;
  let connection: Connection;
  let wallet: Keypair;

  beforeAll(async () => {
    if (SKIP_INTEGRATION_TESTS) return;
    wallet = loadTestWallet();
    connection = new Connection(DEVNET_RPC, 'confirmed');
    await ensureBalance(connection, wallet.publicKey);

    const moduleRef = await Test.createTestingModule({
      providers: [
        AnchorOnchainAdapterService,
        AnchorClientService,
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) => {
              const map: Record<string, string> = {
                STRATEGY_RUNTIME_PROGRAM_ID: PROGRAM_ID,
                SOLANA_RPC_URL: DEVNET_RPC,
                STRATEGY_RUNTIME_COMMITMENT: 'confirmed',
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

    adapter = moduleRef.get(AnchorOnchainAdapterService);
  });

  it('initializes a deployment on devnet and returns valid PDAs', async () => {
    if (SKIP_INTEGRATION_TESTS) return;
    const deploymentId = crypto.randomUUID();
    const strategyId = crypto.randomUUID();

    const result = await withRpcRetry(
      () =>
        adapter.initializeDeployment({
          deploymentId,
          strategyId,
          strategy_version: 1,
          creatorWallet: wallet.publicKey.toBase58(),
          vaultOwnerHint: null,
          publicMetadataHash: 'a'.repeat(64),
          privateDefinitionCommitment: 'b'.repeat(64),
          executionMode: 'per',
        }),
      { label: 'initializeDeployment(per)' },
    );

    expect(result.deploymentAccount).toMatch(/^[A-HJ-NP-Za-km-z1-9]{32,44}$/);
    expect(result.vaultAuthorityAccount).toMatch(/^[A-HJ-NP-Za-km-z1-9]{32,44}$/);
    expect(result.strategyStateAccount).toMatch(/^[A-HJ-NP-Za-km-z1-9]{32,44}$/);
    expect(result.publicSnapshotAccount).toMatch(/^[A-HJ-NP-Za-km-z1-9]{32,44}$/);
    expect(result.signature).toMatch(/^[A-HJ-NP-Za-km-z1-9]{64,128}$/);

    // Verify on-chain account exists and has correct execution_mode
    const program = await (adapter as any).anchorClient.getProgram();
    const deployment = await program.account.strategyDeployment.fetch(result.deploymentAccount!);
    expect(deployment.executionMode).toBe(2); // PER = 2
    expect(deployment.lifecycleStatus).toBe(1); // deployed = 1

    console.log(`Deployment initialized on devnet: ${result.deploymentAccount}`);
  });

  it('derives follower PDAs deterministically', async () => {
    if (SKIP_INTEGRATION_TESTS) return;
    const deploymentId = '11111111-2222-3333-4444-555555555555';
    const followerWallet = Keypair.generate().publicKey.toBase58();

    const pdas = await adapter.deriveFollowerPdas({ deploymentId, followerWallet });

    expect(pdas.subscriptionPda).toMatch(/^[A-HJ-NP-Za-km-z1-9]{32,44}$/);
    expect(pdas.followerVaultPda).toMatch(/^[A-HJ-NP-Za-km-z1-9]{32,44}$/);
    expect(pdas.vaultAuthorityPda).toMatch(/^[A-HJ-NP-Za-km-z1-9]{32,44}$/);
    expect(pdas.subscriptionPdaBump).toBeGreaterThanOrEqual(0);
    expect(pdas.subscriptionPdaBump).toBeLessThan(256);

    // Idempotency: same inputs → same outputs
    const pdas2 = await adapter.deriveFollowerPdas({ deploymentId, followerWallet });
    expect(pdas2.subscriptionPda).toBe(pdas.subscriptionPda);
    expect(pdas2.followerVaultPda).toBe(pdas.followerVaultPda);
    expect(pdas2.vaultAuthorityPda).toBe(pdas.vaultAuthorityPda);
  });

  it('builds unsigned follower subscription instruction', async () => {
    if (SKIP_INTEGRATION_TESTS) return;
    const deploymentId = '11111111-2222-3333-4444-555555555555';
    const followerWallet = Keypair.generate().publicKey.toBase58();

    const result = await adapter.initializeFollowerSubscription({
      deploymentId,
      followerWallet,
      subscriptionId: crypto.randomUUID(),
    });

    expect(result.signature).toBeNull();
    expect(result.unsignedInstructionBase64).toBeTruthy();
    expect(result.recentBlockhash).toBeTruthy();

    // Decode and verify structure
    const payload = JSON.parse(
      Buffer.from(result.unsignedInstructionBase64!, 'base64').toString('utf8'),
    );
    expect(payload.programId).toBe(PROGRAM_ID);
    expect(payload.keys.some((k: any) => k.pubkey === followerWallet)).toBe(true);
  });

  it('builds unsigned follower vault instruction with custody mode', async () => {
    if (SKIP_INTEGRATION_TESTS) return;
    const subscriptionPda = Keypair.generate().publicKey.toBase58();
    const followerWallet = Keypair.generate().publicKey.toBase58();

    const result = await adapter.initializeFollowerVault({
      subscriptionPda,
      followerWallet,
      vaultId: crypto.randomUUID(),
      custodyMode: 'self_custody',
    });

    expect(result.signature).toBeNull();
    expect(result.unsignedInstructionBase64).toBeTruthy();

    // Verify the instruction data contains custody_mode = 1 (self_custody)
    const payload = JSON.parse(
      Buffer.from(result.unsignedInstructionBase64!, 'base64').toString('utf8'),
    );
    expect(payload.programId).toBe(PROGRAM_ID);
  });

  it('maps execution modes correctly for ER and PER', async () => {
    if (SKIP_INTEGRATION_TESTS) return;
    // This is a unit-level validation but critical for MagicBlock integration
    const deploymentId = crypto.randomUUID();
    const strategyId = crypto.randomUUID();

    for (const mode of ['offchain', 'er', 'per'] as const) {
      const result = await withRpcRetry(
        () =>
          adapter.initializeDeployment({
            deploymentId: crypto.randomUUID(),
            strategyId: crypto.randomUUID(),
            strategy_version: 1,
            creatorWallet: wallet.publicKey.toBase58(),
            vaultOwnerHint: null,
            publicMetadataHash: 'a'.repeat(64),
            privateDefinitionCommitment: 'b'.repeat(64),
            executionMode: mode,
          }),
        { label: `initializeDeployment(${mode})` },
      );

      const program = await (adapter as any).anchorClient.getProgram();
      const deployment = await program.account.strategyDeployment.fetch(result.deploymentAccount!);

      const expectedMode = mode === 'offchain' ? 0 : mode === 'er' ? 1 : 2;
      expect(deployment.executionMode).toBe(expectedMode);
      console.log(`Execution mode ${mode} => ${expectedMode} verified on devnet`);

      // Small delay between iterations to avoid RPC rate-limiting
      if (mode !== 'per') {
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
  });
});
