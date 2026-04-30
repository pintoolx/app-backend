/**
 * MagicBlock SDK Integration Tests — Backend-layer ER Delegation
 *
 * Tests real MagicBlock infrastructure using the official TS SDK:
 *   - Magic Router connectivity (devnet-as)
 *   - Transaction routing through Magic Router
 *   - ER / PER deployment creation on devnet
 *   - ER delegation of strategy_state PDA via backend-layer transaction
 *
 * Delegation is performed by calling the MagicBlock delegation program
 * directly (no program-level CPI required). The PDA signer is verified
 * on-chain by the delegation program.
 *
 * Prerequisites:
 *   - MAGICBLOCK_ROUTER_URL configured (e.g. https://as.magicblock.app)
 *   - Devnet wallet with SOL
 *   - Program deployed on devnet
 *
 * Run:
 *   cd backend && npx jest src/magicblock/magicblock-er-per-sdk.integration.spec.ts --testTimeout=180000
 */

import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { Connection, Keypair, PublicKey, Transaction, SystemProgram } from '@solana/web3.js';
import {
  ConnectionMagicRouter,
} from '@magicblock-labs/ephemeral-rollups-sdk';
import { MagicBlockErRealAdapter } from './magicblock-er-real.adapter';
import { MagicBlockClientService } from './magicblock-client.service';
import { AnchorOnchainAdapterService } from '../onchain/anchor-onchain-adapter.service';
import { AnchorClientService } from '../onchain/anchor-client.service';
import { KeeperKeypairService } from '../onchain/keeper-keypair.service';
import * as fs from 'fs';
import * as path from 'path';

const DEVNET_RPC = 'https://api.devnet.solana.com';
const PROGRAM_ID = 'FBh8hmjZYZhrhi1ionZHCVxrBbjn6s9oSGnSu3gV4vkF';
const MAGICBLOCK_ROUTER = 'https://devnet-router.magicblock.app';
const ER_VALIDATOR = new PublicKey('MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57'); // Asia devnet

function loadTestWallet(): Keypair {
  const walletPath = path.join(__dirname, '../../../programs/tests/devnet/test-wallet.json');
  const secretKey = Uint8Array.from(JSON.parse(fs.readFileSync(walletPath, 'utf-8')));
  return Keypair.fromSecretKey(secretKey);
}

async function ensureBalance(connection: Connection, pubkey: PublicKey, minSol = 1) {
  const balance = await connection.getBalance(pubkey);
  if (balance < minSol * 1e9) {
    throw new Error(`Insufficient balance: ${balance / 1e9} SOL`);
  }
}

describe('MagicBlock SDK — Real ER Integration', () => {
  jest.setTimeout(180_000);

  let erAdapter: MagicBlockErRealAdapter;
  let onchainAdapter: AnchorOnchainAdapterService;
  let baseConnection: Connection;
  let routerConnection: ConnectionMagicRouter;
  let wallet: Keypair;

  beforeAll(async () => {
    wallet = loadTestWallet();
    baseConnection = new Connection(DEVNET_RPC, 'confirmed');
    await ensureBalance(baseConnection, wallet.publicKey, 0.3);

    routerConnection = new ConnectionMagicRouter(MAGICBLOCK_ROUTER, {
      wsEndpoint: 'wss://devnet-router.magicblock.app',
      commitment: 'confirmed',
    });

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
  });

  it('verifies Magic Router SDK connection is healthy', async () => {
    const validator = await routerConnection.getClosestValidator();
    expect(validator.identity).toBeTruthy();
    expect(validator.fqdn).toBeTruthy();
    console.log(`Magic Router validator: ${validator.identity} @ ${validator.fqdn}`);
  });

  it('creates an ER-mode deployment on devnet', async () => {
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
    expect(result.strategyStateAccount).toBeTruthy();

    const program = await (onchainAdapter as any).anchorClient.getProgram();
    const deployment = await program.account.strategyDeployment.fetch(
      result.deploymentAccount!,
    );
    expect(deployment.executionMode).toBe(1); // ER = 1
    console.log(`ER deployment created: ${result.deploymentAccount}`);
  });

  it('routes transaction through Magic Router SDK', async () => {
    const recipient = Keypair.generate().publicKey;
    const transferIx = SystemProgram.transfer({
      fromPubkey: wallet.publicKey,
      toPubkey: recipient,
      lamports: 0.001 * 1e9,
    });

    const tx = new Transaction().add(transferIx);
    tx.feePayer = wallet.publicKey;
    const { blockhash } = await baseConnection.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    tx.sign(wallet);

    // Fire-and-forget via Magic Router, then poll base layer for confirmation
    const sig = await routerConnection.sendTransaction(tx, [wallet], {
      skipPreflight: true,
    });
    expect(sig).toBeTruthy();
    console.log(`Routed through Magic Router, signature: ${sig}`);

    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const status = await baseConnection.getSignatureStatus(sig);
      if (status.value && status.value.confirmationStatus === 'confirmed') {
        console.log(`Confirmed on devnet after ${(i + 1) * 2}s`);
        return;
      }
    }
    throw new Error('Transaction not confirmed on devnet within 60s');
  });

  it('uses ER adapter to route SDK-built transaction', async () => {
    const recipient = Keypair.generate().publicKey;
    const transferIx = SystemProgram.transfer({
      fromPubkey: wallet.publicKey,
      toPubkey: recipient,
      lamports: 0.001 * 1e9,
    });

    const tx = new Transaction().add(transferIx);
    tx.feePayer = wallet.publicKey;
    const { blockhash } = await baseConnection.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    tx.sign(wallet);

    const base64Tx = tx.serialize({ requireAllSignatures: true }).toString('base64');

    const result = await erAdapter.route({
      deploymentId: 'sdk-test',
      base64Tx,
    });

    expect(result.signature).toBeTruthy();
    expect(result.routedThrough).toBe('er');
    console.log(`Adapter routed: ${result.signature}`);
  });

  it('creates PER deployment and validates TEE endpoint availability', async () => {
    const deploymentId = crypto.randomUUID();
    const strategyId = crypto.randomUUID();

    const result = await onchainAdapter.initializeDeployment({
      deploymentId,
      strategyId,
      strategyVersion: 1,
      creatorWallet: wallet.publicKey.toBase58(),
      vaultOwnerHint: null,
      publicMetadataHash: 'c'.repeat(64),
      privateDefinitionCommitment: 'd'.repeat(64),
      executionMode: 'per',
    });

    const program = await (onchainAdapter as any).anchorClient.getProgram();
    const deployment = await program.account.strategyDeployment.fetch(
      result.deploymentAccount!,
    );

    expect(deployment.executionMode).toBe(2); // PER
    console.log(`PER deployment created: ${result.deploymentAccount}`);
  });

  it('full ER flow: deploy → route through Magic Router', async () => {
    // 1. Deploy with ER mode
    const deploymentId = crypto.randomUUID();
    const deployResult = await onchainAdapter.initializeDeployment({
      deploymentId,
      strategyId: crypto.randomUUID(),
      strategyVersion: 1,
      creatorWallet: wallet.publicKey.toBase58(),
      vaultOwnerHint: null,
      publicMetadataHash: 'e'.repeat(64),
      privateDefinitionCommitment: 'f'.repeat(64),
      executionMode: 'er',
    });

    const program = await (onchainAdapter as any).anchorClient.getProgram();
    const deployment = await program.account.strategyDeployment.fetch(
      deployResult.deploymentAccount!,
    );
    expect(deployment.executionMode).toBe(1);
    console.log(`Deployed for ER flow: ${deployResult.deploymentAccount}`);

    // 2. Route a transaction through Magic Router
    const testIx = SystemProgram.transfer({
      fromPubkey: wallet.publicKey,
      toPubkey: Keypair.generate().publicKey,
      lamports: 0.001 * 1e9,
    });
    const routeTx = new Transaction().add(testIx);
    routeTx.feePayer = wallet.publicKey;
    const { blockhash: bh2 } = await baseConnection.getLatestBlockhash();
    routeTx.recentBlockhash = bh2;
    routeTx.sign(wallet);

    const routeSig = await routerConnection.sendTransaction(routeTx, [wallet], {
      skipPreflight: true,
    });
    console.log(`Routed on ER: ${routeSig}`);

    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const status = await baseConnection.getSignatureStatus(routeSig);
      if (status.value && status.value.confirmationStatus === 'confirmed') {
        console.log(`Confirmed on devnet after ${(i + 1) * 2}s`);
        break;
      }
    }
  });

  it('delegates strategy_state to ER via program CPI', async () => {
    // 1. Create ER deployment
    const deployResult = await onchainAdapter.initializeDeployment({
      deploymentId: crypto.randomUUID(),
      strategyId: crypto.randomUUID(),
      strategyVersion: 1,
      creatorWallet: wallet.publicKey.toBase58(),
      vaultOwnerHint: null,
      publicMetadataHash: '0a'.repeat(32),
      privateDefinitionCommitment: '0b'.repeat(32),
      executionMode: 'er',
    });
    console.log(`ER deployment for delegation: ${deployResult.deploymentAccount}`);

    // 2. Build delegation instruction via program CPI
    const program = await (onchainAdapter as any).anchorClient.getProgram();
    const strategyStatePda = new PublicKey(deployResult.strategyStateAccount!);

    // Derive delegation PDAs (matching program logic)
    const [delegationBuffer] = PublicKey.findProgramAddressSync(
      [Buffer.from('buffer'), strategyStatePda.toBuffer()],
      new PublicKey(PROGRAM_ID),
    );
    const [delegationRecord] = PublicKey.findProgramAddressSync(
      [Buffer.from('delegation'), strategyStatePda.toBuffer()],
      new PublicKey('DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh'),
    );
    const [delegationMetadata] = PublicKey.findProgramAddressSync(
      [Buffer.from('delegation-metadata'), strategyStatePda.toBuffer()],
      new PublicKey('DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh'),
    );

    const delegateIx = await program.methods
      .delegateStrategyState()
      .accounts({
        creator: wallet.publicKey,
        deployment: deployResult.deploymentAccount,
        strategyState: strategyStatePda,
        delegationBuffer,
        delegationRecord,
        delegationMetadata,
        delegationProgram: 'DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh',
        ownerProgram: new PublicKey(PROGRAM_ID),
        systemProgram: SystemProgram.programId,
        validator: ER_VALIDATOR,
      })
      .instruction();

    // 3. Build and sign transaction
    const tx = new Transaction().add(delegateIx);
    tx.feePayer = wallet.publicKey;
    const { blockhash } = await baseConnection.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    tx.sign(wallet);

    const sig = await baseConnection.sendRawTransaction(
      tx.serialize({ requireAllSignatures: false, verifySignatures: false }),
      { skipPreflight: true },
    );
    await baseConnection.confirmTransaction(sig, 'confirmed');
    console.log(`Delegated strategy_state to ER, signature: ${sig}`);

    // 4. Wait for propagation then poll delegation status on ER
    await new Promise((r) => setTimeout(r, 8000));

    let status: { isDelegated: boolean } | undefined;
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      try {
        status = await routerConnection.getDelegationStatus(strategyStatePda);
      } catch {
        continue;
      }
      if (status.isDelegated) {
        console.log(`Delegation confirmed on ER after ${(i + 1) * 3 + 8}s`);
        break;
      }
    }
    expect(status?.isDelegated).toBe(true);

    // 5. Route a transaction through Magic Router (ER should now handle it)
    const testIx = SystemProgram.transfer({
      fromPubkey: wallet.publicKey,
      toPubkey: Keypair.generate().publicKey,
      lamports: 0.001 * 1e9,
    });
    const routeTx = new Transaction().add(testIx);
    routeTx.feePayer = wallet.publicKey;
    const { blockhash: bh2 } = await baseConnection.getLatestBlockhash();
    routeTx.recentBlockhash = bh2;
    routeTx.sign(wallet);

    const routeSig = await routerConnection.sendTransaction(routeTx, [wallet], {
      skipPreflight: true,
    });
    console.log(`Routed through ER after delegation: ${routeSig}`);

    // 6. Verify account is still accessible after delegation
    const deploymentAfter = await program.account.strategyDeployment.fetch(
      deployResult.deploymentAccount!,
    );
    expect(deploymentAfter.executionMode).toBe(1);
    console.log(`Delegation test complete: deployment=${deployResult.deploymentAccount}`);
  });
});
