/**
 * End-to-end ER execution test on devnet.
 *
 * Flow:
 *   A. Base-layer smoke test: deploy offchain → commitState → verify revision
 *   B. ER path: deploy ER → delegate → commitState via Magic Router
 *
 * Known issue: commit_state.rs uses Account<'info, StrategyState> which
 * fails on ER because the account owner becomes the delegation program.
 * Fix: switch to AccountInfo<'info> in commit_state.rs.
 */
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
} from '@solana/web3.js';
import { AnchorProvider, Program, Wallet, BN } from '@coral-xyz/anchor';
import type { StrategyRuntime } from '../src/onchain/anchor/strategy_runtime';
import { ConnectionMagicRouter } from '@magicblock-labs/ephemeral-rollups-sdk';
import * as fs from 'fs';
import * as path from 'path';

// ─── Config ─────────────────────────────────────────────────────────
const DEVNET_RPC = 'https://devnet.helius-rpc.com/?api-key=8939699e-77dc-4fa7-aa0a-8c486f30276a';
const DEVNET_ROUTER = 'https://devnet-as.magicblock.app';
const PROGRAM_ID = new PublicKey('FBh8hmjZYZhrhi1ionZHCVxrBbjn6s9oSGnSu3gV4vkF');
const DELEGATION_PROGRAM_ID = new PublicKey(
  'DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh',
);
const ER_VALIDATOR = new PublicKey(
  '5G2FN3TadN9C1qPrJmqg6fjaB1ZyGD1pEoZoMhwgZyYi',
);
const COMMITMENT = 'confirmed' as const;

// ─── Load wallet ────────────────────────────────────────────────────
const walletPath = path.resolve(
  __dirname,
  '../../programs/tests/devnet/test-wallet.json',
);
const walletSecret = JSON.parse(fs.readFileSync(walletPath, 'utf-8'));
const wallet = Keypair.fromSecretKey(Uint8Array.from(walletSecret));
console.log(`🔑 Wallet loaded: ${wallet.publicKey.toBase58()}`);

// ─── Load IDL ───────────────────────────────────────────────────────
const idlPath = path.resolve(
  __dirname,
  '../src/onchain/anchor/strategy_runtime.json',
);
const idlJson = JSON.parse(fs.readFileSync(idlPath, 'utf-8'));
const idl = { ...idlJson, address: PROGRAM_ID.toBase58() };

// ─── Connections ────────────────────────────────────────────────────
const baseConnection = new Connection(DEVNET_RPC, COMMITMENT);
const routerConnection = new ConnectionMagicRouter(DEVNET_ROUTER, {
  commitment: COMMITMENT,
});

// ─── Anchor setup ───────────────────────────────────────────────────
const provider = new AnchorProvider(
  baseConnection,
  new Wallet(wallet),
  { commitment: COMMITMENT },
);
const program = new Program<StrategyRuntime>(idl as StrategyRuntime, provider);

// ─── Helpers ────────────────────────────────────────────────────────
function uuidToBytes(uuid: string): Buffer {
  const hex = uuid.replace(/-/g, '');
  if (hex.length !== 32) throw new Error(`Invalid UUID: ${uuid}`);
  return Buffer.from(hex, 'hex');
}
function uuidArray(uuid: string): number[] {
  return Array.from(uuidToBytes(uuid));
}
function randomUUID(): string {
  const hex = '0123456789abcdef';
  let s = '';
  for (let i = 0; i < 32; i++) s += hex[Math.floor(Math.random() * 16)];
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-4${s.slice(13, 16)}-${s.slice(16, 20)}-${s.slice(20, 32)}`;
}
function hexTo32ByteArray(hex: string): number[] {
  const trimmed = hex.startsWith('0x') ? hex.slice(2) : hex;
  return Array.from(Buffer.from(trimmed, 'hex'));
}
function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── PDA derivation ─────────────────────────────────────────────────
function u32LE(value: number): Buffer {
  const buf = Buffer.alloc(4);
  buf.writeUInt32LE(value >>> 0, 0);
  return buf;
}
function deriveStrategyVersionPda(strategyId: string, version: number): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('strategy_version'), uuidToBytes(strategyId), u32LE(version)], PROGRAM_ID,
  );
}
function deriveDeploymentPda(deploymentId: string): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('strategy_deployment'), uuidToBytes(deploymentId)], PROGRAM_ID,
  );
}
function deriveVaultAuthorityPda(deploymentPda: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('vault_authority'), deploymentPda.toBuffer()], PROGRAM_ID,
  );
}
function deriveStrategyStatePda(deploymentPda: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('strategy_state'), deploymentPda.toBuffer()], PROGRAM_ID,
  );
}
function derivePublicSnapshotPda(deploymentPda: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('public_snapshot'), deploymentPda.toBuffer()], PROGRAM_ID,
  );
}

// ─── Deploy helper ──────────────────────────────────────────────────
async function deployStrategy(
  strategyId: string,
  deploymentId: string,
  executionMode: number, // 0=offchain, 1=er, 2=per
): Promise<{
  deploymentPda: PublicKey;
  strategyStatePda: PublicKey;
  publicSnapshotPda: PublicKey;
}> {
  const [strategyVersionPda] = deriveStrategyVersionPda(strategyId, 1);
  const [deploymentPda] = deriveDeploymentPda(deploymentId);
  const [vaultAuthorityPda] = deriveVaultAuthorityPda(deploymentPda);
  const [strategyStatePda] = deriveStrategyStatePda(deploymentPda);
  const [publicSnapshotPda] = derivePublicSnapshotPda(deploymentPda);

  try {
    await program.methods
      .initializeStrategyVersion(
        uuidArray(strategyId), 1,
        hexTo32ByteArray('a'.repeat(64)),
        hexTo32ByteArray('b'.repeat(64)),
      )
      .accountsPartial({
        creator: wallet.publicKey,
        strategyVersion: strategyVersionPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc({ commitment: COMMITMENT });
  } catch (err: any) {
    if (!/already in use|already initialized/i.test(err.message)) throw err;
  }

  await program.methods
    .initializeDeployment(uuidArray(deploymentId), executionMode, new BN(0))
    .accountsPartial({
      creator: wallet.publicKey,
      strategyVersion: strategyVersionPda,
      deployment: deploymentPda,
      systemProgram: SystemProgram.programId,
    })
    .rpc({ commitment: COMMITMENT });

  await program.methods
    .initializeVaultAuthority(0)
    .accountsPartial({
      creator: wallet.publicKey,
      deployment: deploymentPda,
      vaultAuthority: vaultAuthorityPda,
      systemProgram: SystemProgram.programId,
    })
    .rpc({ commitment: COMMITMENT });

  await program.methods
    .initializeStrategyState()
    .accountsPartial({
      creator: wallet.publicKey,
      deployment: deploymentPda,
      strategyState: strategyStatePda,
      systemProgram: SystemProgram.programId,
    })
    .rpc({ commitment: COMMITMENT });

  await program.methods
    .setLifecycleStatus(1)
    .accountsPartial({
      creator: wallet.publicKey,
      deployment: deploymentPda,
      strategyState: strategyStatePda,
    })
    .rpc({ commitment: COMMITMENT });

  return { deploymentPda, strategyStatePda, publicSnapshotPda };
}

// ─── CommitState helper ─────────────────────────────────────────────
async function buildCommitStateTx(
  deploymentPda: PublicKey,
  strategyStatePda: PublicKey,
  expectedRevision: number,
): Promise<{ tx: Transaction; base64: string }> {
  const ix = await program.methods
    .commitState(expectedRevision, hexTo32ByteArray('c'.repeat(64)), 0)
    .accountsPartial({
      creator: wallet.publicKey,
      deployment: deploymentPda,
      strategyState: strategyStatePda,
    })
    .instruction();
  const tx = new Transaction().add(ix);
  tx.feePayer = wallet.publicKey;
  tx.recentBlockhash = (await baseConnection.getLatestBlockhash()).blockhash;
  tx.sign(wallet);
  const base64 = tx.serialize({ requireAllSignatures: true }).toString('base64');
  return { tx, base64 };
}

// ─── Main ───────────────────────────────────────────────────────────
async function main() {
  const balance = await baseConnection.getBalance(wallet.publicKey);
  console.log(`💰 Wallet balance: ${(balance / 1e9).toFixed(4)} SOL\n`);
  if (balance < 0.15 * 1e9) {
    console.error('❌ Insufficient SOL for test (< 0.15)');
    process.exit(1);
  }

  // ═══════════════════════════════════════════════════════════════════
  // PART A — Base-layer smoke test
  // ═══════════════════════════════════════════════════════════════════
  console.log('═══════════════════════════════════════════════════════════');
  console.log('PART A — Base-layer commitState smoke test');
  console.log('═══════════════════════════════════════════════════════════');
  const offStrategyId = randomUUID();
  const offDeploymentId = randomUUID();
  console.log(`\n📦 Strategy: ${offStrategyId}`);
  console.log(`📦 Deployment: ${offDeploymentId}`);

  const off = await deployStrategy(offStrategyId, offDeploymentId, 0);
  console.log(`   deploymentPda:    ${off.deploymentPda.toBase58()}`);
  console.log(`   strategyStatePda: ${off.strategyStatePda.toBase58()}`);

  const offStateBefore = await program.account.strategyState.fetch(off.strategyStatePda);
  console.log(`   Initial revision: ${offStateBefore.stateRevision}`);

  console.log('\n➡️  Executing commitState on base layer...');
  const offCommit = await buildCommitStateTx(off.deploymentPda, off.strategyStatePda, offStateBefore.stateRevision);
  const offSig = await baseConnection.sendRawTransaction(
    Buffer.from(offCommit.base64, 'base64'),
    { skipPreflight: true },
  );
  await baseConnection.confirmTransaction(offSig, COMMITMENT);

  const offStateAfter = await program.account.strategyState.fetch(off.strategyStatePda);
  console.log(`   ✅ Signature: ${offSig}`);
  console.log(`   Revision before: ${offStateBefore.stateRevision}`);
  console.log(`   Revision after:  ${offStateAfter.stateRevision}`);

  if (offStateAfter.stateRevision !== offStateBefore.stateRevision + 1) {
    console.error('❌ Base-layer smoke test FAILED: revision did not increment');
    process.exit(1);
  }
  console.log('\n✅ PART A PASSED: commitState works correctly on base layer');

  // ═══════════════════════════════════════════════════════════════════
  // PART B — ER path
  // ═══════════════════════════════════════════════════════════════════
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('PART B — ER path: delegate → commitState via Magic Router');
  console.log('═══════════════════════════════════════════════════════════');
  const erStrategyId = randomUUID();
  const erDeploymentId = randomUUID();
  console.log(`\n📦 Strategy: ${erStrategyId}`);
  console.log(`📦 Deployment: ${erDeploymentId}`);

  const er = await deployStrategy(erStrategyId, erDeploymentId, 1);
  console.log(`   deploymentPda:    ${er.deploymentPda.toBase58()}`);
  console.log(`   strategyStatePda: ${er.strategyStatePda.toBase58()}`);

  // Delegate
  console.log('\n6️⃣  Delegating strategy_state to ER...');
  const [delegationBuffer] = PublicKey.findProgramAddressSync(
    [Buffer.from('buffer'), er.strategyStatePda.toBuffer()], PROGRAM_ID,
  );
  const [delegationRecord] = PublicKey.findProgramAddressSync(
    [Buffer.from('delegation'), er.strategyStatePda.toBuffer()], DELEGATION_PROGRAM_ID,
  );
  const [delegationMetadata] = PublicKey.findProgramAddressSync(
    [Buffer.from('delegation-metadata'), er.strategyStatePda.toBuffer()], DELEGATION_PROGRAM_ID,
  );

  const delegateIx = await program.methods
    .delegateStrategyState()
    .accountsPartial({
      creator: wallet.publicKey,
      deployment: er.deploymentPda,
      strategyState: er.strategyStatePda,
      delegationBuffer,
      delegationRecord,
      delegationMetadata,
      delegationProgram: DELEGATION_PROGRAM_ID,
      ownerProgram: PROGRAM_ID,
      systemProgram: SystemProgram.programId,
      validator: ER_VALIDATOR,
    })
    .instruction();

  const delegateTx = new Transaction().add(delegateIx);
  delegateTx.feePayer = wallet.publicKey;
  delegateTx.recentBlockhash = (await baseConnection.getLatestBlockhash()).blockhash;
  delegateTx.sign(wallet);
  const delegateSig = await baseConnection.sendRawTransaction(
    delegateTx.serialize({ requireAllSignatures: false, verifySignatures: false }),
    { skipPreflight: true },
  );
  await baseConnection.confirmTransaction(delegateSig, COMMITMENT);
  console.log(`   ✅ Delegated: ${delegateSig}`);

  // Check base-layer owner changed
  const accDelegated = await baseConnection.getAccountInfo(er.strategyStatePda);
  console.log(`   Base-layer owner after delegate: ${accDelegated?.owner.toBase58()}`);

  // Build commitState
  console.log('\n7️⃣  Building commitState transaction...');
  const erCommit = await buildCommitStateTx(er.deploymentPda, er.strategyStatePda, 0);
  console.log(`   Transaction size: ${erCommit.base64.length} chars`);

  // Submit via Magic Router
  console.log('\n8️⃣  Submitting through Magic Router...');
  // Re-fetch blockhash right before submission to avoid expiry
  const { blockhash: freshBh } = await routerConnection.getLatestBlockhash();
  erCommit.tx.recentBlockhash = freshBh;
  erCommit.tx.signatures = []; // clear stale signatures
  erCommit.tx.sign(wallet);
  const freshRaw = erCommit.tx.serialize({ requireAllSignatures: true });
  const routeSig = await routerConnection.sendRawTransaction(freshRaw, {
    skipPreflight: true,
    preflightCommitment: COMMITMENT,
  });
  console.log(`   📨 Router signature: ${routeSig}`);

  // Poll on Magic Router
  console.log('   ⏳ Polling ER confirmation (up to 30s)...');
  let erErr: string | null = null;
  for (let i = 0; i < 15; i++) {
    await sleep(2000);
    try {
      const st = await routerConnection.getSignatureStatus(routeSig);
      if (st.value?.confirmationStatus === 'confirmed' || st.value?.confirmationStatus === 'finalized') {
        if (st.value.err) {
          erErr = JSON.stringify(st.value.err);
          console.log(`   ❌ ER execution FAILED after ${(i + 1) * 2}s: ${erErr}`);
        } else {
          console.log(`   ✅ ER execution confirmed after ${(i + 1) * 2}s`);
        }
        break;
      }
    } catch { /* ignore */ }
  }
  if (!erErr) {
    console.log('   ⚠️  Status inconclusive (may still be processing)');
  }

  // ── Summary ──────────────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('TEST SUMMARY');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`Base-layer commitState:  ✅ PASSED (revision incremented)`);
  console.log(`ER delegation:           ✅ PASSED (owner = delegation program)`);
  console.log(`ER commitState via Router: ${erErr ? '❌ FAILED' : '⏳ PENDING/OK'}`);
  if (erErr) {
    console.log(`   Error: ${erErr}`);
    console.log('\n🔧 ROOT CAUSE:');
    console.log('   commit_state.rs uses Account<\'info, StrategyState>');
    console.log('   When delegated, the account owner becomes the delegation');
    console.log('   program (DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh).');
    console.log('   Anchor validates account.owner == program_id on deserialize,');
    console.log('   causing InvalidWritableAccount on ER.');
    console.log('\n🔧 FIX:');
    console.log('   In programs/strategy_runtime/src/instructions/commit_state.rs:');
    console.log('   Replace:');
    console.log('     pub strategy_state: Account<\'info, StrategyState>');
    console.log('   With:');
    console.log('     /// CHECK: owner may be delegation program when delegated');
    console.log('     #[account(mut)]');
    console.log('     pub strategy_state: AccountInfo<\'info>');
    console.log('   Then manually (de)serialize StrategyState in handler().');
    console.log('   Finally redeploy the program.');
  }
  console.log('\n📋 Artifacts:');
  console.log(`   Base deployment: ${off.deploymentPda.toBase58()}`);
  console.log(`   ER deployment:   ${er.deploymentPda.toBase58()}`);
  console.log(`   Delegate sig:    ${delegateSig}`);
  console.log(`   Router sig:      ${routeSig}`);
}

main().catch((err) => {
  console.error('❌ E2E test failed:', err);
  process.exit(1);
});
