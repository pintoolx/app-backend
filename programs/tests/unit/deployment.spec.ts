import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, Keypair, SystemProgram } from "@solana/web3.js";
import { expect } from "chai";
import { StrategyRuntime } from "../../target/types/strategy_runtime";

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

const ExecutionMode = {
  Offchain: 0,
  Er: 1,
  Per: 2,
} as const;

function randomBytes(n: number): Buffer {
  return Buffer.from(anchor.web3.Keypair.generate().publicKey.toBytes().slice(0, n));
}

function getAnchorErrorCode(err: any): string | null {
  if (err?.error?.errorCode?.code) return err.error.errorCode.code;
  if (err?.message) {
    const m = err.message.match(/Error Code:\s*(\w+)/);
    if (m) return m[1];
  }
  return null;
}

function u32LE(value: number): Buffer {
  const buf = Buffer.alloc(4);
  buf.writeUInt32LE(value, 0);
  return buf;
}

describe("strategy_runtime — Phase 1 Deployment Lifecycle (Unit)", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.strategyRuntime as Program<StrategyRuntime>;

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
    version = Math.floor(Math.random() * 1000) + 1;

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

  async function initializeStrategyVersion() {
    const publicMetadataHash = randomBytes(32);
    const privateDefinitionCommitment = randomBytes(32);
    await program.methods
      .initializeStrategyVersion(
        Array.from(strategyId),
        version,
        Array.from(publicMetadataHash),
        Array.from(privateDefinitionCommitment),
      )
      .accounts({ creator: creator.publicKey } as any)
      .rpc();
  }

  async function initializeDeployment(executionMode = ExecutionMode.Offchain) {
    await program.methods
      .initializeDeployment(Array.from(deploymentId), executionMode, new anchor.BN(1))
      .accountsPartial({
        creator: creator.publicKey,
        strategyVersion: strategyVersionPda,
        deployment: deploymentPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
  }

  async function initializeVaultAuthority(custodyMode = 0) {
    await program.methods
      .initializeVaultAuthority(custodyMode)
      .accountsPartial({
        creator: creator.publicKey,
        deployment: deploymentPda,
        vaultAuthority: vaultAuthorityPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
  }

  async function initializeStrategyState() {
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

  // ───────────────────────────────────────────
  // initialize_strategy_version
  // ───────────────────────────────────────────
  it("initializes a strategy version with correct PDA and fields", async () => {
    await initializeStrategyVersion();
    const sv = await program.account.strategyVersion.fetch(strategyVersionPda);
    expect(sv.creator.toBase58()).to.eq(creator.publicKey.toBase58());
    expect(Array.from(sv.strategyId)).to.deep.eq(Array.from(strategyId));
    expect(sv.version).to.eq(version);
    expect(sv.publicMetadataHash).to.have.lengthOf(32);
    expect(sv.privateDefinitionCommitment).to.have.lengthOf(32);
    expect(Number(sv.registeredSlot)).to.be.greaterThan(0);
  });

  it("rejects duplicate strategy version initialization", async () => {
    await initializeStrategyVersion();
    let raised = false;
    try {
      await initializeStrategyVersion();
    } catch (err: any) {
      raised = true;
      expect(err.toString()).to.match(/custom program error|already in use|AccountAlreadyInitialized/i);
    }
    expect(raised).to.be.true;
  });

  it("creates different PDAs for different versions", async () => {
    await initializeStrategyVersion();
    const v2 = version + 1;
    const [pda2] = PublicKey.findProgramAddressSync(
      [STRATEGY_VERSION_SEED, strategyId, u32LE(v2)],
      program.programId,
    );
    await program.methods
      .initializeStrategyVersion(Array.from(strategyId), v2, Array.from(randomBytes(32)), Array.from(randomBytes(32)))
      .accounts({ creator: creator.publicKey, strategyVersion: pda2 } as any)
      .rpc();
    const sv2 = await program.account.strategyVersion.fetch(pda2);
    expect(sv2.version).to.eq(v2);
  });

  // ───────────────────────────────────────────
  // initialize_deployment
  // ───────────────────────────────────────────
  it("initializes deployment with execution_mode Offchain", async () => {
    await initializeStrategyVersion();
    await initializeDeployment(ExecutionMode.Offchain);
    const d = await program.account.strategyDeployment.fetch(deploymentPda);
    expect(d.creator.toBase58()).to.eq(creator.publicKey.toBase58());
    expect(d.executionMode).to.eq(ExecutionMode.Offchain);
    expect(d.lifecycleStatus).to.eq(Lifecycle.Draft);
  });

  it("initializes deployment with execution_mode ER", async () => {
    await initializeStrategyVersion();
    await initializeDeployment(ExecutionMode.Er);
    const d = await program.account.strategyDeployment.fetch(deploymentPda);
    expect(d.executionMode).to.eq(ExecutionMode.Er);
  });

  it("initializes deployment with execution_mode PER", async () => {
    await initializeStrategyVersion();
    await initializeDeployment(ExecutionMode.Per);
    const d = await program.account.strategyDeployment.fetch(deploymentPda);
    expect(d.executionMode).to.eq(ExecutionMode.Per);
  });

  it("rejects invalid execution_mode (3)", async () => {
    await initializeStrategyVersion();
    let raised = false;
    try {
      await program.methods
        .initializeDeployment(Array.from(deploymentId), 3, new anchor.BN(1))
        .accountsPartial({
          creator: creator.publicKey,
          strategyVersion: strategyVersionPda,
          deployment: deploymentPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
    } catch (err: any) {
      raised = true;
      expect(err.error.errorCode.code).to.eq("InvalidExecutionMode");
    }
    expect(raised).to.be.true;
  });

  it("rejects deployment by unauthorized creator", async () => {
    await initializeStrategyVersion();
    const other = anchor.web3.Keypair.generate();
    // Fund the unauthorized creator so the tx reaches the program constraint check
    const sig = await provider.connection.requestAirdrop(other.publicKey, 2_000_000_000);
    await provider.connection.confirmTransaction(sig, 'confirmed');
    let raised = false;
    try {
      await program.methods
        .initializeDeployment(Array.from(deploymentId), ExecutionMode.Offchain, new anchor.BN(1))
        .accountsPartial({
          creator: other.publicKey,
          strategyVersion: strategyVersionPda,
          deployment: deploymentPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([other])
        .rpc();
    } catch (err: any) {
      raised = true;
      const code = getAnchorErrorCode(err);
      expect(code).to.eq("UnauthorizedCreator");
    }
    expect(raised).to.be.true;
  });

  // ───────────────────────────────────────────
  // initialize_vault_authority
  // ───────────────────────────────────────────
  it("initializes vault authority and wires deployment back", async () => {
    await initializeStrategyVersion();
    await initializeDeployment();
    await initializeVaultAuthority(0);
    const va = await program.account.vaultAuthority.fetch(vaultAuthorityPda);
    expect(va.deployment.toBase58()).to.eq(deploymentPda.toBase58());
    expect(va.creator.toBase58()).to.eq(creator.publicKey.toBase58());
    const d = await program.account.strategyDeployment.fetch(deploymentPda);
    expect(d.vaultAuthority.toBase58()).to.eq(vaultAuthorityPda.toBase58());
  });

  it("rejects vault authority for unauthorized creator", async () => {
    await initializeStrategyVersion();
    await initializeDeployment();
    const other = anchor.web3.Keypair.generate();
    // Fund the unauthorized creator so the tx reaches the program constraint check
    const sig = await provider.connection.requestAirdrop(other.publicKey, 2_000_000_000);
    await provider.connection.confirmTransaction(sig, 'confirmed');
    let raised = false;
    try {
      await program.methods
        .initializeVaultAuthority(0)
        .accountsPartial({
          creator: other.publicKey,
          deployment: deploymentPda,
          vaultAuthority: vaultAuthorityPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([other])
        .rpc();
    } catch (err: any) {
      raised = true;
      const code = getAnchorErrorCode(err);
      expect(code).to.eq("UnauthorizedCreator");
    }
    expect(raised).to.be.true;
  });

  // ───────────────────────────────────────────
  // initialize_strategy_state
  // ───────────────────────────────────────────
  it("initializes strategy state with revision 0", async () => {
    await initializeStrategyVersion();
    await initializeDeployment();
    await initializeStrategyState();
    const s = await program.account.strategyState.fetch(strategyStatePda);
    expect(s.stateRevision).to.eq(0);
    expect(s.privateStateCommitment).to.deep.eq(new Array(32).fill(0));
    expect(s.lastResultCode).to.eq(0);
  });

  // ───────────────────────────────────────────
  // set_lifecycle_status — complete state machine
  // ───────────────────────────────────────────
  it("executes all valid lifecycle transitions", async () => {
    await initializeStrategyVersion();
    await initializeDeployment();
    await initializeStrategyState();

    const transitions = [
      Lifecycle.Draft,
      Lifecycle.Deployed,
      Lifecycle.Paused,
      Lifecycle.Deployed,
      Lifecycle.Stopped,
      Lifecycle.Closed,
    ];

    for (let i = 1; i < transitions.length; i++) {
      await setLifecycle(transitions[i]);
      const d = await program.account.strategyDeployment.fetch(deploymentPda);
      expect(d.lifecycleStatus).to.eq(transitions[i]);
    }
  });

  const illegalTransitions = [
    [Lifecycle.Draft, Lifecycle.Paused],
    [Lifecycle.Draft, Lifecycle.Stopped],
    [Lifecycle.Draft, Lifecycle.Closed],
    [Lifecycle.Deployed, Lifecycle.Closed],
    [Lifecycle.Deployed, Lifecycle.Draft],
    [Lifecycle.Paused, Lifecycle.Paused],
    [Lifecycle.Paused, Lifecycle.Draft],
    [Lifecycle.Stopped, Lifecycle.Deployed],
    [Lifecycle.Stopped, Lifecycle.Paused],
    [Lifecycle.Stopped, Lifecycle.Stopped],
    [Lifecycle.Closed, Lifecycle.Deployed],
  ];

  async function reachLifecycle(status: number) {
    const path: number[] = [];
    if (status === Lifecycle.Draft) return;
    if (status === Lifecycle.Deployed) {
      path.push(Lifecycle.Deployed);
    } else if (status === Lifecycle.Paused) {
      path.push(Lifecycle.Deployed, Lifecycle.Paused);
    } else if (status === Lifecycle.Stopped) {
      path.push(Lifecycle.Deployed, Lifecycle.Stopped);
    } else if (status === Lifecycle.Closed) {
      path.push(Lifecycle.Deployed, Lifecycle.Stopped, Lifecycle.Closed);
    }
    for (const s of path) {
      await setLifecycle(s);
    }
  }

  illegalTransitions.forEach(([from, to]) => {
    it(`rejects illegal transition ${from} -> ${to}`, async () => {
      await initializeStrategyVersion();
      await initializeDeployment();
      await initializeStrategyState();
      await reachLifecycle(from);
      let raised = false;
      try {
        await setLifecycle(to);
      } catch (err: any) {
        raised = true;
        expect(err.error.errorCode.code).to.eq("InvalidLifecycleTransition");
      }
      expect(raised, `expected InvalidLifecycleTransition for ${from} -> ${to}`).to.be.true;
    });
  });

  it("rejects invalid lifecycle code (99)", async () => {
    await initializeStrategyVersion();
    await initializeDeployment();
    await initializeStrategyState();
    let raised = false;
    try {
      await setLifecycle(99);
    } catch (err: any) {
      raised = true;
      expect(err.error.errorCode.code).to.eq("InvalidLifecycleCode");
    }
    expect(raised).to.be.true;
  });

  // ───────────────────────────────────────────
  // commit_state
  // ───────────────────────────────────────────
  it("commits state with monotonically increasing revision", async () => {
    await initializeStrategyVersion();
    await initializeDeployment();
    await initializeStrategyState();
    await setLifecycle(Lifecycle.Deployed);

    for (let rev = 0; rev < 3; rev++) {
      const commitment = Array.from(randomBytes(32));
      await program.methods
        .commitState(rev, commitment as unknown as number[], 200 + rev)
        .accountsPartial({
          creator: creator.publicKey,
          deployment: deploymentPda,
          strategyState: strategyStatePda,
        })
        .rpc();
      const s = await program.account.strategyState.fetch(strategyStatePda);
      expect(s.stateRevision).to.eq(rev + 1);
      expect(s.lastResultCode).to.eq(200 + rev);
      expect(Array.from(s.privateStateCommitment)).to.deep.eq(commitment);
    }
  });

  it("rejects commit_state with stale revision", async () => {
    await initializeStrategyVersion();
    await initializeDeployment();
    await initializeStrategyState();
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
    expect(raised).to.be.true;
  });

  it("rejects commit_state with skipped revision", async () => {
    await initializeStrategyVersion();
    await initializeDeployment();
    await initializeStrategyState();
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
        .commitState(5, commitment as unknown as number[], 0)
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
    expect(raised).to.be.true;
  });

  it("rejects commit_state when deployment is Draft", async () => {
    await initializeStrategyVersion();
    await initializeDeployment();
    await initializeStrategyState();
    // lifecycle stays Draft
    let raised = false;
    try {
      await program.methods
        .commitState(0, Array.from(randomBytes(32)) as unknown as number[], 0)
        .accountsPartial({
          creator: creator.publicKey,
          deployment: deploymentPda,
          strategyState: strategyStatePda,
        })
        .rpc();
    } catch (err: any) {
      raised = true;
      expect(err.error.errorCode.code).to.eq("InvalidLifecycleTransition");
    }
    expect(raised).to.be.true;
  });

  // ───────────────────────────────────────────
  // set_public_snapshot
  // ───────────────────────────────────────────
  it("publishes and updates public snapshot with monotonic revisions", async () => {
    await initializeStrategyVersion();
    await initializeDeployment();

    for (let rev = 1; rev <= 3; rev++) {
      const metrics = Array.from(randomBytes(32));
      await program.methods
        .setPublicSnapshot(rev, 0, 1, rev * 10, metrics as unknown as number[])
        .accountsPartial({
          creator: creator.publicKey,
          deployment: deploymentPda,
          publicSnapshot: publicSnapshotPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      const snap = await program.account.publicSnapshot.fetch(publicSnapshotPda);
      expect(snap.snapshotRevision).to.eq(rev);
      expect(snap.pnlSummaryBps).to.eq(rev * 10);
    }
  });

  it("rejects non-monotonic snapshot revision", async () => {
    await initializeStrategyVersion();
    await initializeDeployment();

    const metrics = Array.from(randomBytes(32));
    await program.methods
      .setPublicSnapshot(5, 0, 1, 0, metrics as unknown as number[])
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
        .setPublicSnapshot(3, 0, 1, 0, metrics as unknown as number[])
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
    expect(raised).to.be.true;
  });

  it("rejects same snapshot revision", async () => {
    await initializeStrategyVersion();
    await initializeDeployment();

    const metrics = Array.from(randomBytes(32));
    await program.methods
      .setPublicSnapshot(1, 0, 1, 0, metrics as unknown as number[])
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
    expect(raised).to.be.true;
  });

  // ───────────────────────────────────────────
  // close_deployment
  // ───────────────────────────────────────────
  it("closes a stopped deployment and returns rent", async () => {
    await initializeStrategyVersion();
    await initializeDeployment();
    await initializeStrategyState();
    await setLifecycle(Lifecycle.Deployed);
    await setLifecycle(Lifecycle.Stopped);

    const preBalance = await provider.connection.getBalance(creator.publicKey);
    await program.methods
      .closeDeployment()
      .accountsPartial({
        creator: creator.publicKey,
        deployment: deploymentPda,
        strategyState: strategyStatePda,
      })
      .rpc();
    const postBalance = await provider.connection.getBalance(creator.publicKey);

    const closed = await program.account.strategyDeployment.fetchNullable(deploymentPda);
    expect(closed).to.be.null;
    const closedState = await program.account.strategyState.fetchNullable(strategyStatePda);
    expect(closedState).to.be.null;
    expect(postBalance).to.be.greaterThan(preBalance); // rent returned
  });

  it("rejects closing a deployed deployment", async () => {
    await initializeStrategyVersion();
    await initializeDeployment();
    await initializeStrategyState();
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

  it("rejects closing by unauthorized creator", async () => {
    await initializeStrategyVersion();
    await initializeDeployment();
    await initializeStrategyState();
    await setLifecycle(Lifecycle.Deployed);
    await setLifecycle(Lifecycle.Stopped);

    const other = anchor.web3.Keypair.generate();
    let raised = false;
    try {
      await program.methods
        .closeDeployment()
        .accountsPartial({
          creator: other.publicKey,
          deployment: deploymentPda,
          strategyState: strategyStatePda,
        })
        .signers([other])
        .rpc();
    } catch (err: any) {
      raised = true;
      expect(err.error.errorCode.code).to.eq("UnauthorizedCreator");
    }
    expect(raised).to.be.true;
  });

  // ───────────────────────────────────────────
  // Full happy path
  // ───────────────────────────────────────────
  it("full creator lifecycle: bootstrap → deploy → commit → snapshot → pause → stop → close", async () => {
    await initializeStrategyVersion();
    await initializeDeployment(ExecutionMode.Per);
    await initializeVaultAuthority();
    await initializeStrategyState();
    await setLifecycle(Lifecycle.Deployed);

    const commitment = Array.from(randomBytes(32));
    await program.methods
      .commitState(0, commitment as unknown as number[], 200)
      .accountsPartial({ creator: creator.publicKey, deployment: deploymentPda, strategyState: strategyStatePda })
      .rpc();

    const metrics = Array.from(randomBytes(32));
    await program.methods
      .setPublicSnapshot(1, 0, 1, 50, metrics as unknown as number[])
      .accountsPartial({
        creator: creator.publicKey,
        deployment: deploymentPda,
        publicSnapshot: publicSnapshotPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    await setLifecycle(Lifecycle.Paused);
    await setLifecycle(Lifecycle.Deployed);
    await setLifecycle(Lifecycle.Stopped);

    await program.methods
      .closeDeployment()
      .accountsPartial({ creator: creator.publicKey, deployment: deploymentPda, strategyState: strategyStatePda })
      .rpc();

    expect(await program.account.strategyDeployment.fetchNullable(deploymentPda)).to.be.null;
  });
});
