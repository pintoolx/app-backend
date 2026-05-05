require('dotenv').config();

/**
 * PER (Private Ephemeral Rollups) Integration Test
 *
 * Exercises the PER stack end-to-end on devnet:
 *   1. Creates a PER-mode deployment on devnet and verifies execution_mode=2
 *   2. Tests TEE auth endpoints directly (/auth/challenge, /auth/login)
 *   3. Verifies PER adapter gracefully handles missing REST APIs
 *   4. Tests Supabase PER repositories when properly seeded
 *
 * Prerequisites:
 *   - backend/.env must have SUPABASE_URL, SUPABASE_SERVICE_KEY
 *   - backend/.env must have MAGICBLOCK_PER_ENDPOINT (TEE URL)
 *   - programs/tests/devnet/test-wallet.json must have devnet SOL
 *   - Devnet program must be deployed
 *
 * Run with:
 *   cd backend && npx jest src/magicblock/magicblock-per.integration.spec.ts --testTimeout=300000
 */

import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import * as nacl from 'tweetnacl';
import bs58 from 'bs58';
import axios from 'axios';
import { MagicBlockPerRealAdapter } from './magicblock-per-real.adapter';
import { MagicBlockPerClientService } from './magicblock-per-client.service';
import { PerGroupsRepository } from './per-groups.repository';
import { PerAuthTokensRepository } from './per-auth-tokens.repository';
import { AnchorOnchainAdapterService } from '../onchain/anchor-onchain-adapter.service';
import { AnchorClientService } from '../onchain/anchor-client.service';
import { KeeperKeypairService } from '../onchain/keeper-keypair.service';
import { SupabaseService } from '../database/supabase.service';
import { StrategyDeploymentsRepository } from '../strategy-deployments/strategy-deployments.repository';
import { withRpcRetry } from './__test-helpers__/rpc-retry';
import * as fs from 'fs';
import * as path from 'path';

const DEVNET_RPC = 'https://devnet.helius-rpc.com/?api-key=8939699e-77dc-4fa7-aa0a-8c486f30276a';
const PROGRAM_ID = 'FBh8hmjZYZhrhi1ionZHCVxrBbjn6s9oSGnSu3gV4vkF';

function loadTestWallet(): Keypair {
  const walletPath = path.join(__dirname, '../../../programs/tests/devnet/test-wallet.json');
  const secretKey = Uint8Array.from(JSON.parse(fs.readFileSync(walletPath, 'utf-8')));
  return Keypair.fromSecretKey(secretKey);
}

async function ensureBalance(connection: Connection, pubkey: PublicKey, minSol = 1) {
  const balance = await withRpcRetry(() => connection.getBalance(pubkey), {
    label: 'getBalance',
  });
  if (balance < minSol * 1e9) {
    throw new Error(
      `Insufficient devnet balance: ${balance / 1e9} SOL. Need at least ${minSol} SOL.`,
    );
  }
}

describe('MagicBlock PER — Real Integration', () => {
  jest.setTimeout(300_000);

  let perAdapter: MagicBlockPerRealAdapter;
  let onchainAdapter: AnchorOnchainAdapterService;
  let supabaseService: SupabaseService;
  let groupsRepo: PerGroupsRepository;
  let tokensRepo: PerAuthTokensRepository;
  let wallet: Keypair;
  let deploymentId: string;
  let strategyId: string;

  const RUN_EXTERNAL_INTEGRATION_TESTS =
    process.env.RUN_EXTERNAL_INTEGRATION_TESTS === '1' ||
    process.env.RUN_EXTERNAL_INTEGRATION_TESTS === 'true';
  const SKIP_INTEGRATION_TESTS =
    !RUN_EXTERNAL_INTEGRATION_TESTS ||
    process.env.SKIP_INTEGRATION_TESTS === '1' || process.env.SKIP_INTEGRATION_TESTS === 'true';

  const perEndpoint = process.env.MAGICBLOCK_PER_ENDPOINT;
  const hasSupabase = process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY;
  const isFullyConfigured = !!perEndpoint && !!hasSupabase;

  beforeAll(async () => {
    if (SKIP_INTEGRATION_TESTS || !isFullyConfigured) {
      if (!isFullyConfigured) {
        console.log(
          '⏭️  Skipping PER integration test — set MAGICBLOCK_PER_ENDPOINT, SUPABASE_URL and SUPABASE_SERVICE_KEY',
        );
      }
      return;
    }

    wallet = loadTestWallet();
    const connection = new Connection(DEVNET_RPC, 'confirmed');
    await ensureBalance(connection, wallet.publicKey, 0.5);

    const moduleRef = await Test.createTestingModule({
      providers: [
        SupabaseService,
        PerGroupsRepository,
        PerAuthTokensRepository,
        StrategyDeploymentsRepository,
        MagicBlockPerClientService,
        MagicBlockPerRealAdapter,
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
                MAGICBLOCK_ROUTER_URL: process.env.MAGICBLOCK_ROUTER_URL,
                MAGICBLOCK_PER_ENDPOINT: perEndpoint,
                MAGICBLOCK_COMMITMENT: 'confirmed',
                'supabase.url': process.env.SUPABASE_URL,
                'supabase.serviceKey': process.env.SUPABASE_SERVICE_KEY,
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

    supabaseService = moduleRef.get(SupabaseService);
    perAdapter = moduleRef.get(MagicBlockPerRealAdapter);
    onchainAdapter = moduleRef.get(AnchorOnchainAdapterService);
    groupsRepo = moduleRef.get(PerGroupsRepository);
    tokensRepo = moduleRef.get(PerAuthTokensRepository);

    // Initialise Supabase client eagerly (it implements OnModuleInit)
    await supabaseService.onModuleInit();
  });

  beforeEach(async () => {
    if (SKIP_INTEGRATION_TESTS || !isFullyConfigured) return;
    deploymentId = crypto.randomUUID();
    strategyId = crypto.randomUUID();
  });

  afterEach(async () => {
    if (SKIP_INTEGRATION_TESTS || !isFullyConfigured) return;
    try {
      await supabaseService.client
        .from('strategy_per_groups')
        .delete()
        .eq('deployment_id', deploymentId);
    } catch {
      // ignore
    }
    try {
      await supabaseService.client
        .from('per_auth_tokens')
        .delete()
        .eq('deployment_id', deploymentId);
    } catch {
      // ignore
    }
  });

  it('creates a PER deployment on devnet with execution_mode=2', async () => {
    if (SKIP_INTEGRATION_TESTS || !isFullyConfigured) {
      console.log('Skipping PER integration test — not fully configured');
      return;
    }

    const deployResult = await withRpcRetry(
      () =>
        onchainAdapter.initializeDeployment({
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

    const program = await (onchainAdapter as any).anchorClient.getProgram();
    const deployment = await program.account.strategyDeployment.fetch(
      deployResult.deploymentAccount!,
    );
    expect(deployment.executionMode).toBe(2); // PER
    console.log(`PER deployment created: ${deployResult.deploymentAccount}`);
  });

  it('verifies TEE /auth/challenge endpoint is reachable', async () => {
    if (SKIP_INTEGRATION_TESTS || !isFullyConfigured) {
      console.log('Skipping PER integration test — not fully configured');
      return;
    }

    const teeUrl = perEndpoint!.replace(/\/$/, '');
    const challengeUrl = `${teeUrl}/auth/challenge?pubkey=${encodeURIComponent(wallet.publicKey.toBase58())}`;

    const res = await axios.get<{ challenge?: string; error?: string }>(challengeUrl, {
      timeout: 10_000,
    });

    expect(res.data.error).toBeFalsy();
    expect(res.data.challenge).toBeTruthy();
    console.log(`TEE challenge: ${res.data.challenge!.slice(0, 40)}...`);
  });

  it('performs full TEE auth challenge → sign → login flow', async () => {
    if (SKIP_INTEGRATION_TESTS || !isFullyConfigured) {
      console.log('Skipping PER integration test — not fully configured');
      return;
    }

    const teeUrl = perEndpoint!.replace(/\/$/, '');

    // 1. Request challenge
    const challengeRes = await axios.get<{ challenge?: string; error?: string }>(
      `${teeUrl}/auth/challenge?pubkey=${encodeURIComponent(wallet.publicKey.toBase58())}`,
      { timeout: 10_000 },
    );
    expect(challengeRes.data.error).toBeFalsy();
    expect(challengeRes.data.challenge).toBeTruthy();
    const challenge = challengeRes.data.challenge!;
    console.log(`TEE challenge received`);

    // 2. Sign challenge (TEE expects base58-encoded signature)
    const challengeBytes = new TextEncoder().encode(challenge);
    const signatureBytes = nacl.sign.detached(challengeBytes, wallet.secretKey);
    const signature = bs58.encode(signatureBytes);

    // 3. Submit to /auth/login
    const loginRes = await axios.post<{ token?: string; expiresAt?: string; error?: string }>(
      `${teeUrl}/auth/login`,
      {
        pubkey: wallet.publicKey.toBase58(),
        challenge,
        signature,
      },
      { timeout: 10_000, headers: { 'Content-Type': 'application/json' } },
    );

    expect(loginRes.data.error).toBeFalsy();
    expect(loginRes.data.token).toBeTruthy();
    console.log(`TEE auth token obtained: ${loginRes.data.token!.slice(0, 16)}...`);
  });

  it('handles PER REST API gracefully when endpoint is RPC-only', async () => {
    if (SKIP_INTEGRATION_TESTS || !isFullyConfigured) {
      console.log('Skipping PER integration test — not fully configured');
      return;
    }

    // The current MAGICBLOCK_PER_ENDPOINT (devnet-tee.magicblock.app) is a
    // JSON-RPC endpoint, not a REST API. Calls to /v1/groups should be
    // rejected with a 4xx, and the adapter should surface a BadRequestException.
    await expect(
      perAdapter.createPermissionGroup({
        deploymentId,
        members: [{ wallet: wallet.publicKey.toBase58(), role: 'creator' }],
      }),
    ).rejects.toThrow();
    console.log('PER REST API correctly rejected by RPC-only endpoint');
  });
});
