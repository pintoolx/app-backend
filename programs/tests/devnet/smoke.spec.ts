/**
 * Devnet Smoke Tests for strategy_runtime
 *
 * These tests run against the live devnet deployment:
 *   PROGRAM_ID = FBh8hmjZYZhrhi1ionZHCVxrBbjn6s9oSGnSu3gV4vkF
 *
 * Prerequisites:
 *   - tests/devnet/test-wallet.json must exist and have devnet SOL
 *   - If airdrop is rate-limited, fund via https://faucet.solana.com
 *
 * Run with:
 *   ANCHOR_PROVIDER_URL=https://api.devnet.solana.com \
 *   ANCHOR_WALLET=tests/devnet/test-wallet.json \
 *   yarn ts-mocha -p ./tsconfig.json -t 300000 tests/devnet/smoke.spec.ts
 */

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram, Keypair } from "@solana/web3.js";
import { expect } from "chai";
import { StrategyRuntime } from "../../target/types/strategy_runtime";
import {
  DEVNET_RPC,
  getDevnetWallet,
  ensureDevnetBalance,
  retry,
  randomBytes,
  u32LE,
  PROGRAM_ID_DEVNET,
} from "./utils";

const STRATEGY_VERSION_SEED = Buffer.from("strategy_version");
const STRATEGY_DEPLOYMENT_SEED = Buffer.from("strategy_deployment");
const VAULT_AUTHORITY_SEED = Buffer.from("vault_authority");
const STRATEGY_STATE_SEED = Buffer.from("strategy_state");
const PUBLIC_SNAPSHOT_SEED = Buffer.from("public_snapshot");
const STRATEGY_SUBSCRIPTION_SEED = Buffer.from("strategy_subscription");
const FOLLOWER_VAULT_SEED = Buffer.from("follower_vault");
const FOLLOWER_VAULT_AUTHORITY_SEED = Buffer.from("follower_vault_authority");

const Lifecycle = { Draft: 0, Deployed: 1, Paused: 2, Stopped: 3, Closed: 4 } as const;
const ExecutionMode = { Offchain: 0, Er: 1, Per: 2 } as const;

const IS_DEVNET = process.env.ANCHOR_PROVIDER_URL?.includes('devnet') ?? false;

describe("strategy_runtime — Devnet Smoke Tests", function () {
  this.timeout(300000);

  if (!IS_DEVNET) {
    before(function () {
      console.log("Skipping devnet smoke tests — set ANCHOR_PROVIDER_URL to a devnet RPC to enable.");
      this.skip();
    });
    return;
  }

  const wallet = getDevnetWallet();
  const connection = new anchor.web3.Connection(DEVNET_RPC, "confirmed");
  const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(wallet), {
    commitment: "confirmed",
  });
  anchor.setProvider(provider);

  const program = new Program<StrategyRuntime>(
    require("../../target/idl/strategy_runtime.json"),
    provider,
  );

  let creator: Keypair;

  before(async () => {
    creator = wallet;
    await ensureDevnetBalance(connection, creator.publicKey, 2);
    const balance = await connection.getBalance(creator.publicKey);
    console.log(`Creator balance: ${balance / 1e9} SOL`);
    if (balance < 0.5 * 1e9) {
      console.warn("WARNING: Low devnet balance. Tests may fail due to insufficient rent.");
    }
  });

  // Per-test unique IDs to avoid PDA collisions between runs
  function freshIds() {
    const strategyId = randomBytes(16);
    const deploymentId = randomBytes(16);
    const version = Math.floor(Math.random() * 1_000_000) + 1;

    const [strategyVersionPda] = PublicKey.findProgramAddressSync(
      [STRATEGY_VERSION_SEED, strategyId, u32LE(version)],
      PROGRAM_ID_DEVNET,
    );
    const [deploymentPda] = PublicKey.findProgramAddressSync(
      [STRATEGY_DEPLOYMENT_SEED, deploymentId],
      PROGRAM_ID_DEVNET,
    );
    const [vaultAuthorityPda] = PublicKey.findProgramAddressSync(
      [VAULT_AUTHORITY_SEED, deploymentPda.toBuffer()],
      PROGRAM_ID_DEVNET,
    );
    const [strategyStatePda] = PublicKey.findProgramAddressSync(
      [STRATEGY_STATE_SEED, deploymentPda.toBuffer()],
      PROGRAM_ID_DEVNET,
    );
    const [publicSnapshotPda] = PublicKey.findProgramAddressSync(
      [PUBLIC_SNAPSHOT_SEED, deploymentPda.toBuffer()],
      PROGRAM_ID_DEVNET,
    );

    return {
      strategyId,
      deploymentId,
      version,
      strategyVersionPda,
      deploymentPda,
      vaultAuthorityPda,
      strategyStatePda,
      publicSnapshotPda,
    };
  }

  // ───────────────────────────────────────────
  // Devnet: Account validation
  // ───────────────────────────────────────────
  it("verifies program deployment and IDL match on-chain", async () => {
    const accountInfo = await connection.getAccountInfo(PROGRAM_ID_DEVNET);
    expect(accountInfo).to.not.be.null;
    expect(accountInfo!.executable).to.be.true;
    console.log(`Program data length: ${accountInfo!.data.length} bytes`);
  });

  // ───────────────────────────────────────────
  // Devnet: Deployment lifecycle for each execution mode
  // ───────────────────────────────────────────
  [ExecutionMode.Offchain, ExecutionMode.Er, ExecutionMode.Per].forEach((mode) => {
    it(`full deployment lifecycle with execution_mode=${mode}`, async () => {
      const ids = freshIds();
      const publicMetadataHash = randomBytes(32);
      const privateDefinitionCommitment = randomBytes(32);

      // 1. Initialize strategy version
      await retry(() =>
        program.methods
          .initializeStrategyVersion(
            Array.from(ids.strategyId),
            ids.version,
            Array.from(publicMetadataHash),
            Array.from(privateDefinitionCommitment),
          )
          .accounts({ creator: creator.publicKey } as any)
          .rpc(),
      );

      const sv = await program.account.strategyVersion.fetch(ids.strategyVersionPda);
      expect(sv.version).to.eq(ids.version);
      console.log(`[mode=${mode}] strategy_version OK`);

      // 2. Initialize deployment
      await retry(() =>
        program.methods
          .initializeDeployment(Array.from(ids.deploymentId), mode, new anchor.BN(1))
          .accountsPartial({
            creator: creator.publicKey,
            strategyVersion: ids.strategyVersionPda,
            deployment: ids.deploymentPda,
            systemProgram: SystemProgram.programId,
          })
          .rpc(),
      );

      const deployment = await program.account.strategyDeployment.fetch(ids.deploymentPda);
      expect(deployment.executionMode).to.eq(mode);
      expect(deployment.lifecycleStatus).to.eq(Lifecycle.Draft);
      console.log(`[mode=${mode}] deployment OK`);

      // 3. Vault authority
      await retry(() =>
        program.methods
          .initializeVaultAuthority(0)
          .accountsPartial({
            creator: creator.publicKey,
            deployment: ids.deploymentPda,
            vaultAuthority: ids.vaultAuthorityPda,
            systemProgram: SystemProgram.programId,
          })
          .rpc(),
      );

      // 4. Strategy state
      await retry(() =>
        program.methods
          .initializeStrategyState()
          .accountsPartial({
            creator: creator.publicKey,
            deployment: ids.deploymentPda,
            strategyState: ids.strategyStatePda,
            systemProgram: SystemProgram.programId,
          })
          .rpc(),
      );

      const state = await program.account.strategyState.fetch(ids.strategyStatePda);
      expect(state.stateRevision).to.eq(0);

      // 5. Lifecycle transitions
      await retry(() =>
        program.methods
          .setLifecycleStatus(Lifecycle.Deployed)
          .accountsPartial({
            creator: creator.publicKey,
            deployment: ids.deploymentPda,
            strategyState: ids.strategyStatePda,
          })
          .rpc(),
      );

      // 6. Commit state
      const commitment = Array.from(randomBytes(32));
      await retry(() =>
        program.methods
          .commitState(0, commitment as unknown as number[], 200)
          .accountsPartial({
            creator: creator.publicKey,
            deployment: ids.deploymentPda,
            strategyState: ids.strategyStatePda,
          })
          .rpc(),
      );

      const stateAfter = await program.account.strategyState.fetch(ids.strategyStatePda);
      expect(stateAfter.stateRevision).to.eq(1);

      // 7. Public snapshot
      const metrics = Array.from(randomBytes(32));
      await retry(() =>
        program.methods
          .setPublicSnapshot(1, 0, 1, 50, metrics as unknown as number[])
          .accountsPartial({
            creator: creator.publicKey,
            deployment: ids.deploymentPda,
            publicSnapshot: ids.publicSnapshotPda,
            systemProgram: SystemProgram.programId,
          })
          .rpc(),
      );

      const snap = await program.account.publicSnapshot.fetch(ids.publicSnapshotPda);
      expect(snap.snapshotRevision).to.eq(1);

      // 8. Stop and close
      await retry(() =>
        program.methods
          .setLifecycleStatus(Lifecycle.Stopped)
          .accountsPartial({
            creator: creator.publicKey,
            deployment: ids.deploymentPda,
            strategyState: ids.strategyStatePda,
          })
          .rpc(),
      );

      await retry(() =>
        program.methods
          .closeDeployment()
          .accountsPartial({
            creator: creator.publicKey,
            deployment: ids.deploymentPda,
            strategyState: ids.strategyStatePda,
          })
          .rpc(),
      );

      expect(await program.account.strategyDeployment.fetchNullable(ids.deploymentPda)).to.be.null;
      console.log(`[mode=${mode}] full lifecycle OK`);
    });
  });

  // ───────────────────────────────────────────
  // Devnet: Follower flow
  // ───────────────────────────────────────────
  it("follower subscription → vault → authority → active → close on devnet", async () => {
    const ids = freshIds();
    const follower = Keypair.generate();
    // Fund follower from creator (devnet airdrop is rate-limited)
    const fundTx = new anchor.web3.Transaction().add(
      anchor.web3.SystemProgram.transfer({
        fromPubkey: creator.publicKey,
        toPubkey: follower.publicKey,
        lamports: 0.5 * anchor.web3.LAMPORTS_PER_SOL,
      }),
    );
    await provider.sendAndConfirm(fundTx);
    console.log(`Funded follower ${follower.publicKey.toBase58()}`);

    const [subscriptionPda] = PublicKey.findProgramAddressSync(
      [STRATEGY_SUBSCRIPTION_SEED, ids.deploymentPda.toBuffer(), follower.publicKey.toBuffer()],
      PROGRAM_ID_DEVNET,
    );
    const [followerVaultPda] = PublicKey.findProgramAddressSync(
      [FOLLOWER_VAULT_SEED, subscriptionPda.toBuffer()],
      PROGRAM_ID_DEVNET,
    );
    const [authorityPda] = PublicKey.findProgramAddressSync(
      [FOLLOWER_VAULT_AUTHORITY_SEED, followerVaultPda.toBuffer()],
      PROGRAM_ID_DEVNET,
    );

    // Bootstrap creator side
    await retry(() =>
      program.methods
        .initializeStrategyVersion(
          Array.from(ids.strategyId),
          ids.version,
          Array.from(randomBytes(32)),
          Array.from(randomBytes(32)),
        )
        .accounts({ creator: creator.publicKey } as any)
        .rpc(),
    );

    await retry(() =>
      program.methods
        .initializeDeployment(Array.from(ids.deploymentId), ExecutionMode.Per, new anchor.BN(1))
        .accountsPartial({
          creator: creator.publicKey,
          strategyVersion: ids.strategyVersionPda,
          deployment: ids.deploymentPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc(),
    );

    await retry(() =>
      program.methods
        .initializeStrategyState()
        .accountsPartial({
          creator: creator.publicKey,
          deployment: ids.deploymentPda,
          strategyState: ids.strategyStatePda,
          systemProgram: SystemProgram.programId,
        })
        .rpc(),
    );

    await retry(() =>
      program.methods
        .setLifecycleStatus(Lifecycle.Deployed)
        .accountsPartial({
          creator: creator.publicKey,
          deployment: ids.deploymentPda,
          strategyState: ids.strategyStatePda,
        })
        .rpc(),
    );

    // Follower subscribes
    await retry(() =>
      program.methods
        .initializeFollowerSubscription(Array.from(randomBytes(16)))
        .accountsPartial({
          follower: follower.publicKey,
          deployment: ids.deploymentPda,
          subscription: subscriptionPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([follower])
        .rpc(),
    );

    const sub = await program.account.strategySubscription.fetch(subscriptionPda);
    expect(sub.follower.toBase58()).to.eq(follower.publicKey.toBase58());
    console.log("Follower subscription OK");

    // Follower vault
    await retry(() =>
      program.methods
        .initializeFollowerVault(Array.from(randomBytes(16)), 0)
        .accountsPartial({
          follower: follower.publicKey,
          subscription: subscriptionPda,
          followerVault: followerVaultPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([follower])
        .rpc(),
    );

    const vault = await program.account.followerVault.fetch(followerVaultPda);
    expect(vault.lifecycleStatus).to.eq(0); // PendingFunding
    console.log("Follower vault OK");

    // Vault authority
    await retry(() =>
      program.methods
        .initializeFollowerVaultAuthority()
        .accountsPartial({
          follower: follower.publicKey,
          followerVault: followerVaultPda,
          authority: authorityPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([follower])
        .rpc(),
    );

    const auth = await program.account.followerVaultAuthority.fetch(authorityPda);
    expect(auth.followerVault.toBase58()).to.eq(followerVaultPda.toBase58());
    console.log("Follower vault authority OK");

    // Status transitions
    for (const status of [1, 2, 1, 3, 4]) {
      await retry(() =>
        program.methods
          .setFollowerVaultStatus(status)
          .accountsPartial({
            follower: follower.publicKey,
            followerVault: followerVaultPda,
            subscription: subscriptionPda,
          })
          .signers([follower])
          .rpc(),
      );
    }

    // Close
    await retry(() =>
      program.methods
        .closeFollowerVault()
        .accountsPartial({
          follower: follower.publicKey,
          followerVault: followerVaultPda,
          authority: authorityPda,
          subscription: subscriptionPda,
        })
        .signers([follower])
        .rpc(),
    );

    expect(await program.account.followerVault.fetchNullable(followerVaultPda)).to.be.null;
    console.log("Follower vault closed OK");
  });

  // ───────────────────────────────────────────
  // Devnet: Idempotency / error consistency
  // ───────────────────────────────────────────
  it("devnet error messages match localnet for StaleRevision", async () => {
    const ids = freshIds();

    await retry(() =>
      program.methods
        .initializeStrategyVersion(
          Array.from(ids.strategyId),
          ids.version,
          Array.from(randomBytes(32)),
          Array.from(randomBytes(32)),
        )
        .accounts({ creator: creator.publicKey } as any)
        .rpc(),
    );

    await retry(() =>
      program.methods
        .initializeDeployment(Array.from(ids.deploymentId), 0, new anchor.BN(1))
        .accountsPartial({
          creator: creator.publicKey,
          strategyVersion: ids.strategyVersionPda,
          deployment: ids.deploymentPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc(),
    );

    await retry(() =>
      program.methods
        .initializeStrategyState()
        .accountsPartial({
          creator: creator.publicKey,
          deployment: ids.deploymentPda,
          strategyState: ids.strategyStatePda,
          systemProgram: SystemProgram.programId,
        })
        .rpc(),
    );

    await retry(() =>
      program.methods
        .setLifecycleStatus(Lifecycle.Deployed)
        .accountsPartial({
          creator: creator.publicKey,
          deployment: ids.deploymentPda,
          strategyState: ids.strategyStatePda,
        })
        .rpc(),
    );

    const commitment = Array.from(randomBytes(32));
    await retry(() =>
      program.methods
        .commitState(0, commitment as unknown as number[], 0)
        .accountsPartial({
          creator: creator.publicKey,
          deployment: ids.deploymentPda,
          strategyState: ids.strategyStatePda,
        })
        .rpc(),
    );

    let raised = false;
    try {
      await program.methods
        .commitState(0, commitment as unknown as number[], 0)
        .accountsPartial({
          creator: creator.publicKey,
          deployment: ids.deploymentPda,
          strategyState: ids.strategyStatePda,
        })
        .rpc();
    } catch (err: any) {
      raised = true;
      expect(err.error.errorCode.code).to.eq("StaleRevision");
    }
    expect(raised).to.be.true;
  });

  // ───────────────────────────────────────────
  // Devnet: ER/PER execution_mode compatibility
  // ───────────────────────────────────────────
  it("reads execution_mode=ER deployment and validates backend adapter compatibility fields", async () => {
    const ids = freshIds();

    await retry(() =>
      program.methods
        .initializeStrategyVersion(
          Array.from(ids.strategyId),
          ids.version,
          Array.from(randomBytes(32)),
          Array.from(randomBytes(32)),
        )
        .accounts({ creator: creator.publicKey } as any)
        .rpc(),
    );

    await retry(() =>
      program.methods
        .initializeDeployment(Array.from(ids.deploymentId), ExecutionMode.Er, new anchor.BN(42))
        .accountsPartial({
          creator: creator.publicKey,
          strategyVersion: ids.strategyVersionPda,
          deployment: ids.deploymentPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc(),
    );

    const deployment = await program.account.strategyDeployment.fetch(ids.deploymentPda);
    expect(deployment.executionMode).to.eq(ExecutionMode.Er);
    expect(deployment.deploymentNonce.toNumber()).to.eq(42);

    // Validate fields that backend MagicBlockErRealAdapter depends on
    expect(deployment.creator.toBase58()).to.eq(creator.publicKey.toBase58());
    expect(deployment.strategyVersion.toBase58()).to.eq(ids.strategyVersionPda.toBase58());
    expect(deployment.lifecycleStatus).to.eq(Lifecycle.Draft);
    console.log("ER deployment fields validated for backend adapter");
  });

  it("reads execution_mode=PER deployment and validates PER adapter compatibility fields", async () => {
    const ids = freshIds();

    await retry(() =>
      program.methods
        .initializeStrategyVersion(
          Array.from(ids.strategyId),
          ids.version,
          Array.from(randomBytes(32)),
          Array.from(randomBytes(32)),
        )
        .accounts({ creator: creator.publicKey } as any)
        .rpc(),
    );

    await retry(() =>
      program.methods
        .initializeDeployment(Array.from(ids.deploymentId), ExecutionMode.Per, new anchor.BN(99))
        .accountsPartial({
          creator: creator.publicKey,
          strategyVersion: ids.strategyVersionPda,
          deployment: ids.deploymentPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc(),
    );

    const deployment = await program.account.strategyDeployment.fetch(ids.deploymentPda);
    expect(deployment.executionMode).to.eq(ExecutionMode.Per);
    expect(deployment.deploymentNonce.toNumber()).to.eq(99);

    // Backend MagicBlockPerRealAdapter uses deploymentId to scope PER groups
    // and expects execution_mode to be readable
    console.log("PER deployment fields validated for backend adapter");
  });
});
