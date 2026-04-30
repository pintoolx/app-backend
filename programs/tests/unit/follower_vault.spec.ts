import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, Keypair, SystemProgram } from "@solana/web3.js";
import { expect } from "chai";
import { StrategyRuntime } from "../../target/types/strategy_runtime";

const STRATEGY_VERSION_SEED = Buffer.from("strategy_version");
const STRATEGY_DEPLOYMENT_SEED = Buffer.from("strategy_deployment");
const STRATEGY_STATE_SEED = Buffer.from("strategy_state");
const STRATEGY_SUBSCRIPTION_SEED = Buffer.from("strategy_subscription");
const FOLLOWER_VAULT_SEED = Buffer.from("follower_vault");
const FOLLOWER_VAULT_AUTHORITY_SEED = Buffer.from("follower_vault_authority");

const Lifecycle = {
  Draft: 0,
  Deployed: 1,
  Paused: 2,
  Stopped: 3,
  Closed: 4,
} as const;

const FollowerLifecycle = {
  PendingFunding: 0,
  Active: 1,
  Paused: 2,
  Exiting: 3,
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

/** Extract Anchor error code from various error shapes. */
function getAnchorErrorCode(err: any): string | null {
  if (err?.error?.errorCode?.code) return err.error.errorCode.code;
  if (err?.message) {
    const m = err.message.match(/Error Code:\s*(\w+)/);
    if (m) return m[1];
  }
  return null;
}

describe("strategy_runtime — Phase 2 Follower Vault (Unit)", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.strategyRuntime as Program<StrategyRuntime>;

  let creator: Keypair;
  let follower: Keypair;
  let strategyId: Buffer;
  let deploymentId: Buffer;
  let version: number;
  let strategyVersionPda: PublicKey;
  let deploymentPda: PublicKey;
  let strategyStatePda: PublicKey;
  let subscriptionPda: PublicKey;
  let followerVaultPda: PublicKey;
  let followerVaultAuthorityPda: PublicKey;

  before(async () => {
    creator = (provider.wallet as anchor.Wallet).payer;
  });

  beforeEach(async () => {
    strategyId = randomBytes(16);
    deploymentId = randomBytes(16);
    version = Math.floor(Math.random() * 1000) + 1;
    follower = anchor.web3.Keypair.generate();
    // Airdrop follower for rent and wait for confirmation
    const sig = await provider.connection.requestAirdrop(follower.publicKey, 2_000_000_000);
    await provider.connection.confirmTransaction(sig, 'confirmed');

    [strategyVersionPda] = PublicKey.findProgramAddressSync(
      [STRATEGY_VERSION_SEED, strategyId, u32LE(version)],
      program.programId,
    );
    [deploymentPda] = PublicKey.findProgramAddressSync(
      [STRATEGY_DEPLOYMENT_SEED, deploymentId],
      program.programId,
    );
    [strategyStatePda] = PublicKey.findProgramAddressSync(
      [STRATEGY_STATE_SEED, deploymentPda.toBuffer()],
      program.programId,
    );
    [subscriptionPda] = PublicKey.findProgramAddressSync(
      [STRATEGY_SUBSCRIPTION_SEED, deploymentPda.toBuffer(), follower.publicKey.toBuffer()],
      program.programId,
    );
    [followerVaultPda] = PublicKey.findProgramAddressSync(
      [FOLLOWER_VAULT_SEED, subscriptionPda.toBuffer()],
      program.programId,
    );
    [followerVaultAuthorityPda] = PublicKey.findProgramAddressSync(
      [FOLLOWER_VAULT_AUTHORITY_SEED, followerVaultPda.toBuffer()],
      program.programId,
    );
  });

  async function bootstrapDeployment() {
    const publicMetadataHash = randomBytes(32);
    const privateDefinitionCommitment = randomBytes(32);
    await program.methods
      .initializeStrategyVersion(
        Array.from(strategyId), version,
        Array.from(publicMetadataHash),
        Array.from(privateDefinitionCommitment),
      )
      .accounts({ creator: creator.publicKey } as any)
      .rpc();

    await program.methods
      .initializeDeployment(Array.from(deploymentId), 0, new anchor.BN(1))
      .accountsPartial({
        creator: creator.publicKey,
        strategyVersion: strategyVersionPda,
        deployment: deploymentPda,
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

  async function setDeploymentLifecycle(status: number) {
    await program.methods
      .setLifecycleStatus(status)
      .accountsPartial({
        creator: creator.publicKey,
        deployment: deploymentPda,
        strategyState: strategyStatePda,
      })
      .rpc();
  }

  async function initializeSubscription() {
    await program.methods
      .initializeFollowerSubscription(Array.from(randomBytes(16)))
      .accountsPartial({
        follower: follower.publicKey,
        deployment: deploymentPda,
        subscription: subscriptionPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([follower])
      .rpc();
  }

  async function initializeFollowerVault(custodyMode = 0) {
    await program.methods
      .initializeFollowerVault(Array.from(randomBytes(16)), custodyMode)
      .accountsPartial({
        follower: follower.publicKey,
        subscription: subscriptionPda,
        followerVault: followerVaultPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([follower])
      .rpc();
  }

  async function initializeFollowerVaultAuthority() {
    await program.methods
      .initializeFollowerVaultAuthority()
      .accountsPartial({
        follower: follower.publicKey,
        followerVault: followerVaultPda,
        authority: followerVaultAuthorityPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([follower])
      .rpc();
  }

  async function setFollowerVaultStatus(status: number) {
    await program.methods
      .setFollowerVaultStatus(status)
      .accountsPartial({
        follower: follower.publicKey,
        followerVault: followerVaultPda,
        subscription: subscriptionPda,
      })
      .signers([follower])
      .rpc();
  }

  // ───────────────────────────────────────────
  // initialize_follower_subscription
  // ───────────────────────────────────────────
  it("initializes follower subscription with correct PDA and fields", async () => {
    await bootstrapDeployment();
    await initializeSubscription();
    const sub = await program.account.strategySubscription.fetch(subscriptionPda);
    expect(sub.deployment.toBase58()).to.eq(deploymentPda.toBase58());
    expect(sub.follower.toBase58()).to.eq(follower.publicKey.toBase58());
    expect(sub.lifecycleStatus).to.eq(FollowerLifecycle.PendingFunding);
    expect(sub.followerVault.toBase58()).to.eq(PublicKey.default.toBase58());
  });

  it("rejects subscription without follower signer", async () => {
    await bootstrapDeployment();
    const other = anchor.web3.Keypair.generate();
    let raised = false;
    try {
      await program.methods
        .initializeFollowerSubscription(Array.from(randomBytes(16)))
        .accountsPartial({
          follower: other.publicKey,
          deployment: deploymentPda,
          subscription: subscriptionPda,
          systemProgram: SystemProgram.programId,
        })
        // intentionally missing signer
        .rpc();
    } catch (err: any) {
      raised = true;
      expect(err.toString()).to.match(/Missing signer|signature verification failed/i);
    }
    expect(raised).to.be.true;
  });

  it("rejects duplicate subscription for same (deployment, follower)", async () => {
    await bootstrapDeployment();
    await initializeSubscription();
    let raised = false;
    try {
      await initializeSubscription();
    } catch (err: any) {
      raised = true;
      expect(err.toString()).to.match(/custom program error|already in use/i);
    }
    expect(raised).to.be.true;
  });

  // ───────────────────────────────────────────
  // initialize_follower_vault
  // ───────────────────────────────────────────
  it("initializes follower vault with correct fields and backwires subscription", async () => {
    await bootstrapDeployment();
    await initializeSubscription();
    await initializeFollowerVault(0);

    const vault = await program.account.followerVault.fetch(followerVaultPda);
    expect(vault.subscription.toBase58()).to.eq(subscriptionPda.toBase58());
    expect(vault.deployment.toBase58()).to.eq(deploymentPda.toBase58());
    expect(vault.follower.toBase58()).to.eq(follower.publicKey.toBase58());
    expect(vault.lifecycleStatus).to.eq(FollowerLifecycle.PendingFunding);
    expect(vault.custodyMode).to.eq(0);

    const sub = await program.account.strategySubscription.fetch(subscriptionPda);
    expect(sub.followerVault.toBase58()).to.eq(followerVaultPda.toBase58());
  });

  it("rejects follower vault for unauthorized follower", async () => {
    await bootstrapDeployment();
    await initializeSubscription();
    const other = anchor.web3.Keypair.generate();
    // Fund the unauthorized follower so the tx reaches the program constraint check
    await fundAccount(other.publicKey);
    let raised = false;
    try {
      await program.methods
        .initializeFollowerVault(Array.from(randomBytes(16)), 0)
        .accountsPartial({
          follower: other.publicKey,
          subscription: subscriptionPda,
          followerVault: followerVaultPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([other])
        .rpc();
    } catch (err: any) {
      raised = true;
      const code = getAnchorErrorCode(err);
      expect(code).to.eq("UnauthorizedFollower");
    }
    expect(raised).to.be.true;
  });

  it("rejects invalid custody_mode (99)", async () => {
    await bootstrapDeployment();
    await initializeSubscription();
    let raised = false;
    try {
      await initializeFollowerVault(99);
    } catch (err: any) {
      raised = true;
      expect(err.error.errorCode.code).to.eq("InvalidCustodyMode");
    }
    expect(raised).to.be.true;
  });

  // ───────────────────────────────────────────
  // initialize_follower_vault_authority
  // ───────────────────────────────────────────
  it("initializes follower vault authority and backwires vault", async () => {
    await bootstrapDeployment();
    await initializeSubscription();
    await initializeFollowerVault();
    await initializeFollowerVaultAuthority();

    const auth = await program.account.followerVaultAuthority.fetch(followerVaultAuthorityPda);
    expect(auth.followerVault.toBase58()).to.eq(followerVaultPda.toBase58());
    expect(auth.follower.toBase58()).to.eq(follower.publicKey.toBase58());

    const vault = await program.account.followerVault.fetch(followerVaultPda);
    expect(vault.authority.toBase58()).to.eq(followerVaultAuthorityPda.toBase58());
  });

  it("rejects authority init for unauthorized follower", async () => {
    await bootstrapDeployment();
    await initializeSubscription();
    await initializeFollowerVault();
    const other = anchor.web3.Keypair.generate();
    // Fund the unauthorized follower so the tx reaches the program constraint check
    await fundAccount(other.publicKey);
    let raised = false;
    try {
      await program.methods
        .initializeFollowerVaultAuthority()
        .accountsPartial({
          follower: other.publicKey,
          followerVault: followerVaultPda,
          authority: followerVaultAuthorityPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([other])
        .rpc();
    } catch (err: any) {
      raised = true;
      const code = getAnchorErrorCode(err);
      expect(code).to.eq("UnauthorizedFollower");
    }
    expect(raised).to.be.true;
  });

  // ───────────────────────────────────────────
  // set_follower_vault_status
  // ───────────────────────────────────────────
  it("executes all valid follower vault lifecycle transitions", async () => {
    await bootstrapDeployment();
    await initializeSubscription();
    await initializeFollowerVault();

    const transitions = [
      FollowerLifecycle.PendingFunding,
      FollowerLifecycle.Active,
      FollowerLifecycle.Paused,
      FollowerLifecycle.Active,
      FollowerLifecycle.Exiting,
      FollowerLifecycle.Closed,
    ];

    for (let i = 1; i < transitions.length; i++) {
      await setFollowerVaultStatus(transitions[i]);
      const vault = await program.account.followerVault.fetch(followerVaultPda);
      const sub = await program.account.strategySubscription.fetch(subscriptionPda);
      expect(vault.lifecycleStatus).to.eq(transitions[i]);
      expect(sub.lifecycleStatus).to.eq(transitions[i]);
    }
  });

  async function reachFollowerStatus(status: number) {
    const path: number[] = [];
    if (status === FollowerLifecycle.PendingFunding) return;
    if (status === FollowerLifecycle.Active) {
      path.push(FollowerLifecycle.Active);
    } else if (status === FollowerLifecycle.Paused) {
      path.push(FollowerLifecycle.Active, FollowerLifecycle.Paused);
    } else if (status === FollowerLifecycle.Exiting) {
      path.push(FollowerLifecycle.Active, FollowerLifecycle.Exiting);
    } else if (status === FollowerLifecycle.Closed) {
      // Use the shortest path: PendingFunding -> Closed
      path.push(FollowerLifecycle.Closed);
    }
    for (const s of path) {
      await setFollowerVaultStatus(s);
    }
  }

  const illegalFollowerTransitions = [
    [FollowerLifecycle.Active, FollowerLifecycle.PendingFunding],
    [FollowerLifecycle.Active, FollowerLifecycle.Closed],
    [FollowerLifecycle.Paused, FollowerLifecycle.PendingFunding],
    [FollowerLifecycle.Paused, FollowerLifecycle.Closed],
    [FollowerLifecycle.Exiting, FollowerLifecycle.Active],
    [FollowerLifecycle.Exiting, FollowerLifecycle.Paused],
    [FollowerLifecycle.Closed, FollowerLifecycle.Active],
    [FollowerLifecycle.Closed, FollowerLifecycle.PendingFunding],
  ];

  illegalFollowerTransitions.forEach(([from, to]) => {
    it(`rejects illegal follower transition ${from} -> ${to}`, async () => {
      await bootstrapDeployment();
      await initializeSubscription();
      await initializeFollowerVault();
      await reachFollowerStatus(from);
      let raised = false;
      try {
        await setFollowerVaultStatus(to);
      } catch (err: any) {
        raised = true;
        expect(err.error.errorCode.code).to.eq("InvalidLifecycleTransition");
      }
      expect(raised, `expected InvalidLifecycleTransition for ${from} -> ${to}`).to.be.true;
    });
  });

  it("rejects invalid follower lifecycle code (99)", async () => {
    await bootstrapDeployment();
    await initializeSubscription();
    await initializeFollowerVault();
    let raised = false;
    try {
      await setFollowerVaultStatus(99);
    } catch (err: any) {
      raised = true;
      expect(err.error.errorCode.code).to.eq("InvalidLifecycleCode");
    }
    expect(raised).to.be.true;
  });

  it("rejects status change by unauthorized follower", async () => {
    await bootstrapDeployment();
    await initializeSubscription();
    await initializeFollowerVault();
    const other = anchor.web3.Keypair.generate();
    let raised = false;
    try {
      await program.methods
        .setFollowerVaultStatus(FollowerLifecycle.Active)
        .accountsPartial({
          follower: other.publicKey,
          followerVault: followerVaultPda,
          subscription: subscriptionPda,
        })
        .signers([other])
        .rpc();
    } catch (err: any) {
      raised = true;
      const code = getAnchorErrorCode(err);
      expect(code).to.eq("UnauthorizedFollower");
    }
    expect(raised).to.be.true;
  });

  it("rejects status change with mismatched subscription", async () => {
    await bootstrapDeployment();
    await initializeSubscription();
    await initializeFollowerVault();

    // Create another subscription with different PDA
    const otherSubPda = PublicKey.findProgramAddressSync(
      [STRATEGY_SUBSCRIPTION_SEED, deploymentPda.toBuffer(), creator.publicKey.toBuffer()],
      program.programId,
    )[0];

    await program.methods
      .initializeFollowerSubscription(Array.from(randomBytes(16)))
      .accountsPartial({
        follower: creator.publicKey,
        deployment: deploymentPda,
        subscription: otherSubPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    let raised = false;
    try {
      await program.methods
        .setFollowerVaultStatus(FollowerLifecycle.Active)
        .accountsPartial({
          follower: follower.publicKey,
          followerVault: followerVaultPda,
          subscription: otherSubPda, // wrong subscription
        })
        .signers([follower])
        .rpc();
    } catch (err: any) {
      raised = true;
      expect(err.error.errorCode.code).to.eq("SubscriptionDeploymentMismatch");
    }
    expect(raised).to.be.true;
  });

  // ───────────────────────────────────────────
  // close_follower_vault
  // ───────────────────────────────────────────
  it("closes follower vault, authority, and subscription when closed", async () => {
    await bootstrapDeployment();
    await initializeSubscription();
    await initializeFollowerVault();
    await initializeFollowerVaultAuthority();

    await setFollowerVaultStatus(FollowerLifecycle.Active);
    await setFollowerVaultStatus(FollowerLifecycle.Exiting);
    await setFollowerVaultStatus(FollowerLifecycle.Closed);

    const preBalance = await provider.connection.getBalance(follower.publicKey);
    await program.methods
      .closeFollowerVault()
      .accountsPartial({
        follower: follower.publicKey,
        followerVault: followerVaultPda,
        authority: followerVaultAuthorityPda,
        subscription: subscriptionPda,
      })
      .signers([follower])
      .rpc();
    const postBalance = await provider.connection.getBalance(follower.publicKey);

    expect(await program.account.followerVault.fetchNullable(followerVaultPda)).to.be.null;
    expect(await program.account.followerVaultAuthority.fetchNullable(followerVaultAuthorityPda)).to.be.null;
    expect(await program.account.strategySubscription.fetchNullable(subscriptionPda)).to.be.null;
    expect(postBalance).to.be.greaterThan(preBalance);
  });

  it("rejects closing active follower vault", async () => {
    await bootstrapDeployment();
    await initializeSubscription();
    await initializeFollowerVault();
    await initializeFollowerVaultAuthority();
    await setFollowerVaultStatus(FollowerLifecycle.Active);

    let raised = false;
    try {
      await program.methods
        .closeFollowerVault()
        .accountsPartial({
          follower: follower.publicKey,
          followerVault: followerVaultPda,
          authority: followerVaultAuthorityPda,
          subscription: subscriptionPda,
        })
        .signers([follower])
        .rpc();
    } catch (err: any) {
      raised = true;
      expect(err.error.errorCode.code).to.eq("FollowerVaultNotClosed");
    }
    expect(raised).to.be.true;
  });

  it("rejects closing by unauthorized follower", async () => {
    await bootstrapDeployment();
    await initializeSubscription();
    await initializeFollowerVault();
    await initializeFollowerVaultAuthority();
    await setFollowerVaultStatus(FollowerLifecycle.Active);
    await setFollowerVaultStatus(FollowerLifecycle.Exiting);
    await setFollowerVaultStatus(FollowerLifecycle.Closed);

    const other = anchor.web3.Keypair.generate();
    let raised = false;
    try {
      await program.methods
        .closeFollowerVault()
        .accountsPartial({
          follower: other.publicKey,
          followerVault: followerVaultPda,
          authority: followerVaultAuthorityPda,
          subscription: subscriptionPda,
        })
        .signers([other])
        .rpc();
    } catch (err: any) {
      raised = true;
      expect(err.error.errorCode.code).to.eq("UnauthorizedFollower");
    }
    expect(raised).to.be.true;
  });

  // ───────────────────────────────────────────
  // Multi-follower concurrent subscriptions
  // ───────────────────────────────────────────
  async function fundAccount(pubkey: PublicKey, lamports = 2_000_000_000) {
    const sig = await provider.connection.requestAirdrop(pubkey, lamports);
    await provider.connection.confirmTransaction(sig, 'confirmed');
  }

  it("allows multiple followers to subscribe to the same deployment", async () => {
    await bootstrapDeployment();
    await setDeploymentLifecycle(Lifecycle.Deployed);

    const followers: Keypair[] = [];
    for (let i = 0; i < 3; i++) {
      const f = anchor.web3.Keypair.generate();
      followers.push(f);
      await fundAccount(f.publicKey);

      const [subPda] = PublicKey.findProgramAddressSync(
        [STRATEGY_SUBSCRIPTION_SEED, deploymentPda.toBuffer(), f.publicKey.toBuffer()],
        program.programId,
      );
      const [vaultPda] = PublicKey.findProgramAddressSync(
        [FOLLOWER_VAULT_SEED, subPda.toBuffer()],
        program.programId,
      );
      const [authPda] = PublicKey.findProgramAddressSync(
        [FOLLOWER_VAULT_AUTHORITY_SEED, vaultPda.toBuffer()],
        program.programId,
      );

      await program.methods
        .initializeFollowerSubscription(Array.from(randomBytes(16)))
        .accountsPartial({
          follower: f.publicKey,
          deployment: deploymentPda,
          subscription: subPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([f])
        .rpc();

      await program.methods
        .initializeFollowerVault(Array.from(randomBytes(16)), 0)
        .accountsPartial({
          follower: f.publicKey,
          subscription: subPda,
          followerVault: vaultPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([f])
        .rpc();

      await program.methods
        .initializeFollowerVaultAuthority()
        .accountsPartial({
          follower: f.publicKey,
          followerVault: vaultPda,
          authority: authPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([f])
        .rpc();

      const sub = await program.account.strategySubscription.fetch(subPda);
      expect(sub.follower.toBase58()).to.eq(f.publicKey.toBase58());
      const vault = await program.account.followerVault.fetch(vaultPda);
      expect(vault.subscription.toBase58()).to.eq(subPda.toBase58());
    }
  });

  // ───────────────────────────────────────────
  // Full end-to-end follower flow
  // ───────────────────────────────────────────
  it("full follower lifecycle: subscribe → vault → authority → active → pause → exit → close", async () => {
    await bootstrapDeployment();
    await setDeploymentLifecycle(Lifecycle.Deployed);
    await initializeSubscription();
    await initializeFollowerVault(1); // self_custody
    await initializeFollowerVaultAuthority();

    await setFollowerVaultStatus(FollowerLifecycle.Active);
    await setFollowerVaultStatus(FollowerLifecycle.Paused);
    await setFollowerVaultStatus(FollowerLifecycle.Active);
    await setFollowerVaultStatus(FollowerLifecycle.Exiting);
    await setFollowerVaultStatus(FollowerLifecycle.Closed);

    await program.methods
      .closeFollowerVault()
      .accountsPartial({
        follower: follower.publicKey,
        followerVault: followerVaultPda,
        authority: followerVaultAuthorityPda,
        subscription: subscriptionPda,
      })
      .signers([follower])
      .rpc();

    expect(await program.account.followerVault.fetchNullable(followerVaultPda)).to.be.null;
  });
});
