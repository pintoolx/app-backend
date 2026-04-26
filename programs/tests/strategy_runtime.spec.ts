import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, Keypair, SystemProgram } from "@solana/web3.js";
import { expect } from "chai";
import { StrategyRuntime } from "../target/types/strategy_runtime";

const STRATEGY_VERSION_SEED = Buffer.from("strategy_version");
const STRATEGY_DEPLOYMENT_SEED = Buffer.from("strategy_deployment");
const VAULT_AUTHORITY_SEED = Buffer.from("vault_authority");
const STRATEGY_STATE_SEED = Buffer.from("strategy_state");
const PUBLIC_SNAPSHOT_SEED = Buffer.from("public_snapshot");

const Lifecycle = {
  Draft: 0,
  Deployed: 1,
  Paused: 2,
  Stopped: 3,
  Closed: 4,
} as const;

function randomBytes(n: number): Buffer {
  return Buffer.from(anchor.web3.Keypair.generate().publicKey.toBytes().slice(0, n));
}

function u32LE(value: number): Buffer {
  const buf = Buffer.alloc(4);
  buf.writeUInt32LE(value, 0);
  return buf;
}

describe("strategy_runtime", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.strategyRuntime as Program<StrategyRuntime>;

  // Per-test fixtures so each spec gets a fresh strategy + deployment.
  let creator: Keypair;
  let strategyId: Buffer;
  let deploymentId: Buffer;
  let version: number;
  let strategyVersionPda: PublicKey;
  let deploymentPda: PublicKey;
  let vaultAuthorityPda: PublicKey;
  let strategyStatePda: PublicKey;
  let publicSnapshotPda: PublicKey;

  before(async () => {
    creator = (provider.wallet as anchor.Wallet).payer;
  });

  beforeEach(async () => {
    strategyId = randomBytes(16);
    deploymentId = randomBytes(16);
    version = 1;

    [strategyVersionPda] = PublicKey.findProgramAddressSync(
      [STRATEGY_VERSION_SEED, strategyId, u32LE(version)],
      program.programId,
    );
    [deploymentPda] = PublicKey.findProgramAddressSync(
      [STRATEGY_DEPLOYMENT_SEED, deploymentId],
      program.programId,
    );
    [vaultAuthorityPda] = PublicKey.findProgramAddressSync(
      [VAULT_AUTHORITY_SEED, deploymentPda.toBuffer()],
      program.programId,
    );
    [strategyStatePda] = PublicKey.findProgramAddressSync(
      [STRATEGY_STATE_SEED, deploymentPda.toBuffer()],
      program.programId,
    );
    [publicSnapshotPda] = PublicKey.findProgramAddressSync(
      [PUBLIC_SNAPSHOT_SEED, deploymentPda.toBuffer()],
      program.programId,
    );
  });

  async function bootstrapDeployment(executionMode = 0) {
    const publicMetadataHash = randomBytes(32);
    const privateDefinitionCommitment = randomBytes(32);
    const sidArr = Array.from(strategyId);
    const didArr = Array.from(deploymentId);
    const hashArr = Array.from(publicMetadataHash);
    const commitmentArr = Array.from(privateDefinitionCommitment);

    await program.methods
      .initializeStrategyVersion(
        sidArr as unknown as number[],
        version,
        hashArr as unknown as number[],
        commitmentArr as unknown as number[],
      )
      .accounts({
        creator: creator.publicKey,
        // strategyVersion is auto-resolved via PDA seeds
      } as any)
      .rpc();

    await program.methods
      .initializeDeployment(
        didArr as unknown as number[],
        executionMode,
        new anchor.BN(1),
      )
      .accountsPartial({
        creator: creator.publicKey,
        strategyVersion: strategyVersionPda,
        deployment: deploymentPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    await program.methods
      .initializeVaultAuthority(0)
      .accountsPartial({
        creator: creator.publicKey,
        deployment: deploymentPda,
        vaultAuthority: vaultAuthorityPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    await program.methods
      .initializeStrategyState()
      .accountsPartial({
        creator: creator.publicKey,
        deployment: deploymentPda,
        strategyState: strategyStatePda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
  }

  async function setLifecycle(status: number) {
    await program.methods
      .setLifecycleStatus(status)
      .accountsPartial({
        creator: creator.publicKey,
        deployment: deploymentPda,
        strategyState: strategyStatePda,
      })
      .rpc();
  }

  it("happy path: bootstrap, transition to deployed, commit state, set snapshot, stop, close", async () => {
    await bootstrapDeployment();
    await setLifecycle(Lifecycle.Deployed);

    const newCommitment = Array.from(randomBytes(32));
    await program.methods
      .commitState(0, newCommitment as unknown as number[], 200)
      .accountsPartial({
        creator: creator.publicKey,
        deployment: deploymentPda,
        strategyState: strategyStatePda,
      })
      .rpc();

    let state = await program.account.strategyState.fetch(strategyStatePda);
    expect(state.stateRevision).to.eq(1);
    expect(state.lastResultCode).to.eq(200);

    const metricsHash = Array.from(randomBytes(32));
    await program.methods
      .setPublicSnapshot(1, 0, 1, 50, metricsHash as unknown as number[])
      .accountsPartial({
        creator: creator.publicKey,
        deployment: deploymentPda,
        publicSnapshot: publicSnapshotPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    let snap = await program.account.publicSnapshot.fetch(publicSnapshotPda);
    expect(snap.snapshotRevision).to.eq(1);
    expect(snap.pnlSummaryBps).to.eq(50);

    await setLifecycle(Lifecycle.Stopped);
    await program.methods
      .closeDeployment()
      .accountsPartial({
        creator: creator.publicKey,
        deployment: deploymentPda,
        strategyState: strategyStatePda,
      })
      .rpc();

    const closed = await program.account.strategyDeployment.fetchNullable(deploymentPda);
    expect(closed).to.be.null;
  });

  it("commit_state with stale revision fails (replay protection)", async () => {
    await bootstrapDeployment();
    await setLifecycle(Lifecycle.Deployed);

    const commitment = Array.from(randomBytes(32));
    await program.methods
      .commitState(0, commitment as unknown as number[], 0)
      .accountsPartial({
        creator: creator.publicKey,
        deployment: deploymentPda,
        strategyState: strategyStatePda,
      })
      .rpc();

    let raised = false;
    try {
      await program.methods
        .commitState(0, commitment as unknown as number[], 0)
        .accountsPartial({
          creator: creator.publicKey,
          deployment: deploymentPda,
          strategyState: strategyStatePda,
        })
        .rpc();
    } catch (err: any) {
      raised = true;
      expect(err.error.errorCode.code).to.eq("StaleRevision");
    }
    expect(raised, "expected StaleRevision error").to.be.true;
  });

  it("set_public_snapshot rejects non-monotonic revisions", async () => {
    await bootstrapDeployment();
    await setLifecycle(Lifecycle.Deployed);

    const metrics = Array.from(randomBytes(32));
    await program.methods
      .setPublicSnapshot(2, 0, 1, 0, metrics as unknown as number[])
      .accountsPartial({
        creator: creator.publicKey,
        deployment: deploymentPda,
        publicSnapshot: publicSnapshotPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    let raised = false;
    try {
      await program.methods
        .setPublicSnapshot(1, 0, 1, 0, metrics as unknown as number[])
        .accountsPartial({
          creator: creator.publicKey,
          deployment: deploymentPda,
          publicSnapshot: publicSnapshotPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
    } catch (err: any) {
      raised = true;
      expect(err.error.errorCode.code).to.eq("SnapshotNotMonotonic");
    }
    expect(raised, "expected SnapshotNotMonotonic").to.be.true;
  });

  it("set_lifecycle_status rejects illegal transitions", async () => {
    await bootstrapDeployment();
    await setLifecycle(Lifecycle.Deployed);
    await setLifecycle(Lifecycle.Stopped);

    let raised = false;
    try {
      await setLifecycle(Lifecycle.Deployed);
    } catch (err: any) {
      raised = true;
      expect(err.error.errorCode.code).to.eq("InvalidLifecycleTransition");
    }
    expect(raised).to.be.true;
  });

  it("close_deployment requires stopped state", async () => {
    await bootstrapDeployment();
    await setLifecycle(Lifecycle.Deployed);

    let raised = false;
    try {
      await program.methods
        .closeDeployment()
        .accountsPartial({
          creator: creator.publicKey,
          deployment: deploymentPda,
          strategyState: strategyStatePda,
        })
        .rpc();
    } catch (err: any) {
      raised = true;
      expect(err.error.errorCode.code).to.eq("DeploymentNotStopped");
    }
    expect(raised).to.be.true;
  });
});
