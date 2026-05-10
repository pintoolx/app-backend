import { Injectable, Logger, InternalServerErrorException } from '@nestjs/common';
import { BN } from '@coral-xyz/anchor';
import { PublicKey, SystemProgram, Transaction, TransactionInstruction } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from '@solana/spl-token';
import { AnchorClientService } from './anchor-client.service';
import { KeeperKeypairService } from './keeper-keypair.service';
import {
  type BuildCommitStateTransactionResult,
  type BuildFundIntentInstructionParams,
  type BuildWithdrawInstructionParams,
  type CloseDeploymentParams,
  type CloseFollowerVaultParams,
  type ClosePublicSnapshotParams,
  type CloseVaultAuthorityParams,
  type CommitStateParams,
  type DelegateStrategyStateToErParams,
  type DeriveFollowerPdasParams,
  type DeploymentLifecycleStatus,
  type DeploymentExecutionMode,
  type FollowerOnchainInstructionResult,
  type FollowerPdaSet,
  type FollowerVaultLifecycleStatus,
  type BuildAdjustSubscriptionParamsInstructionParams,
  type FundIntentInstruction,
  type InitializeDeploymentParams,
  type InitializeDeploymentResult,
  type InitializeFollowerSubscriptionParams,
  type InitializeFollowerVaultAuthorityParams,
  type InitializeFollowerVaultParams,
  type OnchainAdapterPort,
  type OnchainCommitResult,
  type ReadVaultTokenBalanceParams,
  type SetFollowerVaultStatusParams,
  type SetKeeperParams,
  type SetLifecycleStatusParams,
  type SetPublicSnapshotParams,
  type VaultTokenBalance,
  type WithdrawInstruction,
} from './onchain-adapter.port';
import {
  deriveDeploymentPda,
  deriveFollowerVaultAta,
  deriveFollowerVaultAuthorityPda,
  deriveFollowerVaultPda,
  derivePublicSnapshotPda,
  deriveStrategyStatePda,
  deriveStrategyVersionPda,
  deriveSubscriptionPda,
  deriveVaultAuthorityPda,
  hexTo32ByteArray,
  uuidToBytes,
} from './anchor/pda';

/** Wrapped SOL pseudo-mint — used as a "no SPL token account, lamports only" sentinel. */
const NATIVE_SOL_MINT = 'So11111111111111111111111111111111111111112';

const FOLLOWER_LIFECYCLE_TO_CODE: Record<FollowerVaultLifecycleStatus, number> = {
  pending_funding: 0,
  active: 1,
  paused: 2,
  exiting: 3,
  closed: 4,
};

/**
 * Encodes follower-vault custody modes (`FollowerVaultCustodyMode`) into the
 * single-byte `custody_mode` enum on `FollowerVault` accounts.
 *
 * ⚠️ DO NOT reuse this mapper for `VaultAuthority.custody_mode`. The Anchor
 * program uses an *asymmetric* byte encoding for that other account
 * (0=public_self_custody, 1=program_owned, 2=private_payments_relay), so
 * sharing a single encoder would silently miswrite bytes. If a
 * `VaultAuthority` codec is ever needed, add a second mapper next to this
 * one — never extend this one.
 *
 * Backend currently only writes `FollowerVault.custody_mode`; the asymmetric
 * `VaultAuthority` encoding is documented in `2026-05-08-strategy-runtime-spec.md`.
 */
const CUSTODY_MODE_TO_CODE: Record<'program_owned' | 'self_custody', number> = {
  program_owned: 0,
  self_custody: 1,
};

const LIFECYCLE_TO_CODE: Record<DeploymentLifecycleStatus, number> = {
  draft: 0,
  deployed: 1,
  paused: 2,
  stopped: 3,
  closed: 4,
};

const EXECUTION_MODE_TO_CODE: Record<DeploymentExecutionMode, number> = {
  offchain: 0,
  er: 1,
  per: 2,
};

const RISK_BAND_TO_CODE: Record<string, number> = {
  unknown: 0,
  low: 1,
  medium: 2,
  high: 3,
};

const SNAPSHOT_STATUS_TO_CODE: Record<string, number> = {
  running: 0,
  paused: 1,
  stopped: 2,
  closed: 3,
};

/**
 * Anchor-backed implementation of the OnchainAdapterPort.
 *
 * The keeper keypair is used as creator/signer for all instructions in
 * Phase 1 (single-signer model). Future phases will switch to delegated
 * signing where the wallet co-signs and the keeper only relays.
 */
@Injectable()
export class AnchorOnchainAdapterService implements OnchainAdapterPort {
  private readonly logger = new Logger(AnchorOnchainAdapterService.name);

  constructor(
    private readonly anchorClient: AnchorClientService,
    private readonly keeperKeypairService: KeeperKeypairService,
  ) {}

  async initializeDeployment(
    params: InitializeDeploymentParams,
  ): Promise<InitializeDeploymentResult> {
    const program = await this.anchorClient.getProgram();
    const programId = this.anchorClient.getProgramId();
    const provider = await this.anchorClient.getProvider();
    const creator = provider.wallet.publicKey;

    const [strategyVersionPda] = deriveStrategyVersionPda(
      programId,
      params.strategyId,
      params.strategy_version,
    );
    const [deploymentPda] = deriveDeploymentPda(programId, params.deploymentId);
    const [vaultAuthorityPda] = deriveVaultAuthorityPda(programId, deploymentPda);
    const [strategyStatePda] = deriveStrategyStatePda(programId, deploymentPda);
    const [publicSnapshotPda] = derivePublicSnapshotPda(programId, deploymentPda);

    // Idempotently register the strategy version. If the account already
    // exists we skip; any other failure surfaces as 500.
    try {
      await program.methods
        .initializeStrategyVersion(
          this.uuidArray(params.strategyId),
          params.strategy_version,
          hexTo32ByteArray(params.publicMetadataHash),
          hexTo32ByteArray(params.privateDefinitionCommitment),
        )
        .accountsPartial({
          creator,
          strategyVersion: strategyVersionPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
    } catch (err) {
      if (!this.isAccountAlreadyExistsError(err)) {
        throw this.toInternalError('initializeStrategyVersion', err);
      }
      this.logger.debug(
        `strategy_version ${strategyVersionPda.toBase58()} already exists, skipping init`,
      );
    }

    let initSig: string | null = null;
    try {
      initSig = await program.methods
        .initializeDeployment(
          this.uuidArray(params.deploymentId),
          EXECUTION_MODE_TO_CODE[params.executionMode],
          new BN(0),
        )
        .accountsPartial({
          creator,
          strategyVersion: strategyVersionPda,
          deployment: deploymentPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
    } catch (err) {
      // If a previous attempt (or a parallel caller using the same
      // deploymentId) already created the deployment PDA, treat it as a
      // no-op and continue. PDAs are deterministic, so re-issuing the
      // same instruction is safe.
      if (!this.isAccountAlreadyExistsError(err)) {
        throw this.toInternalError('initializeDeployment', err);
      }
      this.logger.debug(`deployment ${deploymentPda.toBase58()} already exists, skipping init`);
    }

    try {
      await program.methods
        .initializeVaultAuthority(0)
        .accountsPartial({
          creator,
          deployment: deploymentPda,
          vaultAuthority: vaultAuthorityPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
    } catch (err) {
      if (!this.isAccountAlreadyExistsError(err)) {
        throw this.toInternalError('initializeVaultAuthority', err);
      }
      this.logger.debug(
        `vault_authority ${vaultAuthorityPda.toBase58()} already exists, skipping init`,
      );
    }

    try {
      await program.methods
        .initializeStrategyState()
        .accountsPartial({
          creator,
          deployment: deploymentPda,
          strategyState: strategyStatePda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
    } catch (err) {
      if (!this.isAccountAlreadyExistsError(err)) {
        throw this.toInternalError('initializeStrategyState', err);
      }
      this.logger.debug(
        `strategy_state ${strategyStatePda.toBase58()} already exists, skipping init`,
      );
    }

    try {
      await program.methods
        .setLifecycleStatus(LIFECYCLE_TO_CODE.deployed)
        .accountsPartial({
          creator,
          deployment: deploymentPda,
          strategyState: strategyStatePda,
        })
        .rpc();
    } catch (err) {
      // Re-issuing setLifecycleStatus(deployed) on an already-deployed
      // strategy is a no-op from the operator's perspective; the program
      // surfaces this as an "invalid transition" / state error which we can
      // safely ignore.
      if (!this.isLifecycleAlreadySetError(err)) {
        throw this.toInternalError('setLifecycleStatus(deployed)', err);
      }
      this.logger.debug(
        `lifecycle for ${deploymentPda.toBase58()} already deployed, skipping transition`,
      );
    }

    return {
      deploymentAccount: deploymentPda.toBase58(),
      vaultAuthorityAccount: vaultAuthorityPda.toBase58(),
      strategyStateAccount: strategyStatePda.toBase58(),
      publicSnapshotAccount: publicSnapshotPda.toBase58(),
      signature: initSig,
    };
  }

  async setLifecycleStatus(
    params: SetLifecycleStatusParams,
  ): Promise<{ signature: string | null }> {
    const program = await this.anchorClient.getProgram();
    const programId = this.anchorClient.getProgramId();
    const provider = await this.anchorClient.getProvider();
    const creator = provider.wallet.publicKey;

    const [deploymentPda] = deriveDeploymentPda(programId, params.deploymentId);
    const [strategyStatePda] = deriveStrategyStatePda(programId, deploymentPda);

    try {
      const sig = await program.methods
        .setLifecycleStatus(LIFECYCLE_TO_CODE[params.newStatus])
        .accountsPartial({
          creator,
          deployment: deploymentPda,
          strategyState: strategyStatePda,
        })
        .rpc();
      return { signature: sig };
    } catch (err) {
      throw this.toInternalError('setLifecycleStatus', err);
    }
  }

  async commitState(params: CommitStateParams): Promise<OnchainCommitResult> {
    const program = await this.anchorClient.getProgram();
    const programId = this.anchorClient.getProgramId();
    const provider = await this.anchorClient.getProvider();
    const creator = provider.wallet.publicKey;

    const [deploymentPda] = deriveDeploymentPda(programId, params.deploymentId);
    const [strategyStatePda] = deriveStrategyStatePda(programId, deploymentPda);

    try {
      const sig = await program.methods
        .commitState(
          params.expectedRevision,
          hexTo32ByteArray(params.newPrivateStateCommitment),
          params.lastResultCode,
        )
        .accountsPartial({
          creator,
          deployment: deploymentPda,
          strategyState: strategyStatePda,
        })
        .rpc();
      return { signature: sig, newStateRevision: params.expectedRevision + 1 };
    } catch (err) {
      throw this.toInternalError('commitState', err);
    }
  }

  /**
   * Build a signed commitState transaction for MagicBlock ER routing.
   *
   * Uses Anchor's `.instruction()` to build the instruction, wraps it in a
   * legacy Transaction, attaches a recent blockhash, and signs with the
   * keeper keypair. The serialized base64 transaction can be forwarded
   * through Magic Router so it is routed to the ER when strategy_state is
   * delegated.
   */
  async buildCommitStateTransaction(
    params: CommitStateParams,
  ): Promise<BuildCommitStateTransactionResult> {
    const program = await this.anchorClient.getProgram();
    const programId = this.anchorClient.getProgramId();
    const provider = await this.anchorClient.getProvider();
    const creator = provider.wallet.publicKey;

    const [deploymentPda] = deriveDeploymentPda(programId, params.deploymentId);
    const [strategyStatePda] = deriveStrategyStatePda(programId, deploymentPda);

    try {
      const ix = await program.methods
        .commitState(
          params.expectedRevision,
          hexTo32ByteArray(params.newPrivateStateCommitment),
          params.lastResultCode,
        )
        .accountsPartial({
          creator,
          deployment: deploymentPda,
          strategyState: strategyStatePda,
        })
        .instruction();

      const tx = new Transaction().add(ix);
      tx.feePayer = creator;

      const { blockhash } = await provider.connection.getLatestBlockhash();
      tx.recentBlockhash = blockhash;

      const keeper = await this.keeperKeypairService.loadKeypair();
      tx.sign(keeper);

      const serialized = tx.serialize({ requireAllSignatures: true });
      return { transactionBase64: Buffer.from(serialized).toString('base64') };
    } catch (err) {
      throw this.toInternalError('buildCommitStateTransaction', err);
    }
  }

  async setPublicSnapshot(params: SetPublicSnapshotParams): Promise<OnchainCommitResult> {
    const program = await this.anchorClient.getProgram();
    const programId = this.anchorClient.getProgramId();
    const provider = await this.anchorClient.getProvider();
    const creator = provider.wallet.publicKey;

    const [deploymentPda] = deriveDeploymentPda(programId, params.deploymentId);
    const [publicSnapshotPda] = derivePublicSnapshotPda(programId, deploymentPda);

    const statusCode = SNAPSHOT_STATUS_TO_CODE[params.status] ?? 0;
    const riskBandCode =
      params.riskBand && RISK_BAND_TO_CODE[params.riskBand] !== undefined
        ? RISK_BAND_TO_CODE[params.riskBand]
        : 0;
    const pnlBps = params.pnlSummaryBps ?? 0;

    try {
      const sig = await program.methods
        .setPublicSnapshot(
          params.expectedSnapshotRevision,
          statusCode,
          riskBandCode,
          pnlBps,
          hexTo32ByteArray(params.publicMetricsHash),
        )
        .accountsPartial({
          creator,
          deployment: deploymentPda,
          publicSnapshot: publicSnapshotPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      return {
        signature: sig,
        newStateRevision: params.expectedSnapshotRevision,
      };
    } catch (err) {
      throw this.toInternalError('setPublicSnapshot', err);
    }
  }

  async closeDeployment(params: CloseDeploymentParams): Promise<{ signature: string | null }> {
    const program = await this.anchorClient.getProgram();
    const programId = this.anchorClient.getProgramId();
    const provider = await this.anchorClient.getProvider();
    const creator = provider.wallet.publicKey;

    const [deploymentPda] = deriveDeploymentPda(programId, params.deploymentId);
    const [strategyStatePda] = deriveStrategyStatePda(programId, deploymentPda);

    try {
      const sig = await program.methods
        .closeDeployment()
        .accountsPartial({
          creator,
          deployment: deploymentPda,
          strategyState: strategyStatePda,
        })
        .rpc();
      return { signature: sig };
    } catch (err) {
      throw this.toInternalError('closeDeployment', err);
    }
  }

  // -------------------------- Phase 2 follower-vault helpers ---------------
  //
  // Follower-vault instructions all require the follower wallet to sign. The
  // Anchor adapter does not have access to follower keypairs (creator/keeper
  // signs the deployment instructions only). For Phase 2 we therefore *build*
  // the instruction here and return it base64-encoded so the caller (a
  // Crossmint custodial flow or a frontend wallet) can attach a recent
  // blockhash, request the follower's signature, and broadcast it. Real
  // submission via Anchor is reserved for environments where the follower's
  // keypair is materialised (e.g. delegated session keys, future work).

  async deriveFollowerPdas(params: DeriveFollowerPdasParams): Promise<FollowerPdaSet> {
    const programId = this.anchorClient.getProgramId();
    const followerKey = new PublicKey(params.followerWallet);
    const [deploymentPda] = deriveDeploymentPda(programId, params.deploymentId);
    const [subscriptionPda, subscriptionPdaBump] = deriveSubscriptionPda(
      programId,
      deploymentPda,
      followerKey,
    );
    const [followerVaultPda, followerVaultPdaBump] = deriveFollowerVaultPda(
      programId,
      subscriptionPda,
    );
    const [vaultAuthorityPda, vaultAuthorityPdaBump] = deriveFollowerVaultAuthorityPda(
      programId,
      followerVaultPda,
    );
    return {
      subscriptionPda: subscriptionPda.toBase58(),
      subscriptionPdaBump,
      followerVaultPda: followerVaultPda.toBase58(),
      followerVaultPdaBump,
      vaultAuthorityPda: vaultAuthorityPda.toBase58(),
      vaultAuthorityPdaBump,
    };
  }

  async initializeFollowerSubscription(
    params: InitializeFollowerSubscriptionParams,
  ): Promise<FollowerOnchainInstructionResult> {
    try {
      const program = await this.anchorClient.getProgram();
      const programId = this.anchorClient.getProgramId();
      const followerKey = new PublicKey(params.followerWallet);
      const [deploymentPda] = deriveDeploymentPda(programId, params.deploymentId);
      const [subscriptionPda] = deriveSubscriptionPda(programId, deploymentPda, followerKey);
      // The TS IDL bindings haven't been regenerated for the follower-vault
      // instructions yet; cast the methods namespace so we can call the JSON
      // IDL directly. Safe because the discriminators are validated at the
      // RPC layer.
      const methods = program.methods as unknown as Record<string, (...args: unknown[]) => any>;
      const ix = await methods
        .initializeFollowerSubscription(this.uuidArray(params.subscriptionId))
        .accountsPartial({
          follower: followerKey,
          deployment: deploymentPda,
          subscription: subscriptionPda,
          systemProgram: SystemProgram.programId,
        })
        .instruction();
      return await this.encodeUnsigned(ix as TransactionInstruction);
    } catch (err) {
      throw this.toInternalError('initializeFollowerSubscription', err);
    }
  }

  async initializeFollowerVault(
    params: InitializeFollowerVaultParams,
  ): Promise<FollowerOnchainInstructionResult> {
    try {
      const program = await this.anchorClient.getProgram();
      const programId = this.anchorClient.getProgramId();
      const followerKey = new PublicKey(params.followerWallet);
      const subscriptionKey = new PublicKey(params.subscriptionPda);
      const [followerVaultPda] = deriveFollowerVaultPda(programId, subscriptionKey);
      const methods = program.methods as unknown as Record<string, (...args: unknown[]) => any>;
      const ix = await methods
        .initializeFollowerVault(
          this.uuidArray(params.vaultId),
          CUSTODY_MODE_TO_CODE[params.custodyMode],
        )
        .accountsPartial({
          follower: followerKey,
          subscription: subscriptionKey,
          followerVault: followerVaultPda,
          systemProgram: SystemProgram.programId,
        })
        .instruction();
      return await this.encodeUnsigned(ix as TransactionInstruction);
    } catch (err) {
      throw this.toInternalError('initializeFollowerVault', err);
    }
  }

  async initializeFollowerVaultAuthority(
    params: InitializeFollowerVaultAuthorityParams,
  ): Promise<FollowerOnchainInstructionResult> {
    try {
      const program = await this.anchorClient.getProgram();
      const programId = this.anchorClient.getProgramId();
      const followerKey = new PublicKey(params.followerWallet);
      const followerVaultKey = new PublicKey(params.followerVaultPda);
      const [authorityPda] = deriveFollowerVaultAuthorityPda(programId, followerVaultKey);
      const methods = program.methods as unknown as Record<string, (...args: unknown[]) => any>;
      const ix = await methods
        .initializeFollowerVaultAuthority()
        .accountsPartial({
          follower: followerKey,
          followerVault: followerVaultKey,
          authority: authorityPda,
          systemProgram: SystemProgram.programId,
        })
        .instruction();
      return await this.encodeUnsigned(ix as TransactionInstruction);
    } catch (err) {
      throw this.toInternalError('initializeFollowerVaultAuthority', err);
    }
  }

  async setFollowerVaultStatus(
    params: SetFollowerVaultStatusParams,
  ): Promise<FollowerOnchainInstructionResult> {
    try {
      const program = await this.anchorClient.getProgram();
      const followerKey = new PublicKey(params.followerWallet);
      const followerVaultKey = new PublicKey(params.followerVaultPda);
      const subscriptionKey = new PublicKey(params.subscriptionPda);
      const methods = program.methods as unknown as Record<string, (...args: unknown[]) => any>;
      const ix = await methods
        .setFollowerVaultStatus(FOLLOWER_LIFECYCLE_TO_CODE[params.lifecycleStatus])
        .accountsPartial({
          follower: followerKey,
          followerVault: followerVaultKey,
          subscription: subscriptionKey,
        })
        .instruction();
      return await this.encodeUnsigned(ix as TransactionInstruction);
    } catch (err) {
      throw this.toInternalError('setFollowerVaultStatus', err);
    }
  }

  async closeFollowerVault(
    params: CloseFollowerVaultParams,
  ): Promise<FollowerOnchainInstructionResult> {
    try {
      const program = await this.anchorClient.getProgram();
      const followerKey = new PublicKey(params.followerWallet);
      const followerVaultKey = new PublicKey(params.followerVaultPda);
      const authorityKey = new PublicKey(params.authorityPda);
      const subscriptionKey = new PublicKey(params.subscriptionPda);
      const methods = program.methods as unknown as Record<string, (...args: unknown[]) => any>;
      const ix = await methods
        .closeFollowerVault()
        .accountsPartial({
          follower: followerKey,
          followerVault: followerVaultKey,
          authority: authorityKey,
          subscription: subscriptionKey,
        })
        .instruction();
      return await this.encodeUnsigned(ix as TransactionInstruction);
    } catch (err) {
      throw this.toInternalError('closeFollowerVault', err);
    }
  }

  async buildFundIntentInstruction(
    params: BuildFundIntentInstructionParams,
  ): Promise<FundIntentInstruction> {
    const lamports = BigInt(params.amount);
    const fromPub = new PublicKey(params.fromWallet);
    const toPub = new PublicKey(params.vaultAuthorityPda);
    const ix = SystemProgram.transfer({ fromPubkey: fromPub, toPubkey: toPub, lamports });
    let recentBlockhash: string | null = null;
    try {
      const provider = await this.anchorClient.getProvider();
      const latest = await provider.connection.getLatestBlockhash('confirmed');
      recentBlockhash = latest.blockhash;
    } catch (err) {
      this.logger.debug(
        `buildFundIntentInstruction: blockhash fetch failed (${err instanceof Error ? err.message : err})`,
      );
    }
    let vaultTokenAccount: string | null = null;
    if (params.mint !== NATIVE_SOL_MINT) {
      try {
        vaultTokenAccount = deriveFollowerVaultAta(
          new PublicKey(params.mint),
          new PublicKey(params.vaultAuthorityPda),
        ).toBase58();
      } catch (err) {
        this.logger.debug(
          `buildFundIntentInstruction: ATA derivation failed (${err instanceof Error ? err.message : err})`,
        );
      }
    }
    return {
      instructionBase64: this.encodeInstructionPayload(ix),
      recentBlockhash,
      vaultAuthorityPda: params.vaultAuthorityPda,
      mint: params.mint,
      amount: params.amount,
      vaultTokenAccount,
    };
  }

  async buildAdjustSubscriptionParamsInstruction(
    params: BuildAdjustSubscriptionParamsInstructionParams,
  ): Promise<FollowerOnchainInstructionResult> {
    try {
      const program = await this.anchorClient.getProgram();
      const followerKey = new PublicKey(params.followerWallet);
      const subscriptionKey = new PublicKey(params.subscriptionPda);
      const expectedRevisionBn = new BN(params.expectedRevision);
      const commitment = hexTo32ByteArray(params.newConfigCommitmentHex);
      const methods = program.methods as unknown as Record<string, (...args: unknown[]) => any>;
      const ix = await methods
        .adjustSubscriptionParams(expectedRevisionBn, commitment)
        .accountsPartial({
          follower: followerKey,
          subscription: subscriptionKey,
        })
        .instruction();
      return await this.encodeUnsigned(ix as TransactionInstruction);
    } catch (err) {
      throw this.toInternalError('buildAdjustSubscriptionParamsInstruction', err);
    }
  }

  async buildWithdrawInstruction(
    params: BuildWithdrawInstructionParams,
  ): Promise<WithdrawInstruction> {
    try {
      const program = await this.anchorClient.getProgram();
      const followerKey = new PublicKey(params.followerWallet);
      const subscriptionKey = new PublicKey(params.subscriptionPda);
      const followerVaultKey = new PublicKey(params.followerVaultPda);
      const vaultAuthorityKey = new PublicKey(params.vaultAuthorityPda);
      const mintKey = new PublicKey(params.mint);

      const vaultTokenAccount = deriveFollowerVaultAta(mintKey, vaultAuthorityKey);
      const followerTokenAccount = getAssociatedTokenAddressSync(
        mintKey,
        followerKey,
        /* allowOwnerOffCurve */ false,
        TOKEN_PROGRAM_ID,
      );

      const amountBn = new BN(params.amount);
      const methods = program.methods as unknown as Record<string, (...args: unknown[]) => any>;
      const ix = await methods
        .withdrawFromVault(amountBn)
        .accountsPartial({
          follower: followerKey,
          subscription: subscriptionKey,
          followerVault: followerVaultKey,
          vaultAuthority: vaultAuthorityKey,
          mint: mintKey,
          vaultTokenAccount,
          followerTokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .instruction();

      let recentBlockhash: string | null = null;
      try {
        const provider = await this.anchorClient.getProvider();
        const latest = await provider.connection.getLatestBlockhash('confirmed');
        recentBlockhash = latest.blockhash;
      } catch (err) {
        this.logger.debug(
          `buildWithdrawInstruction: blockhash fetch failed (${err instanceof Error ? err.message : err})`,
        );
      }

      return {
        instructionBase64: this.encodeInstructionPayload(ix as TransactionInstruction),
        recentBlockhash,
        vaultTokenAccount: vaultTokenAccount.toBase58(),
        followerTokenAccount: followerTokenAccount.toBase58(),
        amount: params.amount,
      };
    } catch (err) {
      throw this.toInternalError('buildWithdrawInstruction', err);
    }
  }

  async readVaultTokenBalance(params: ReadVaultTokenBalanceParams): Promise<VaultTokenBalance> {
    const vaultAuthority = new PublicKey(params.vaultAuthorityPda);
    const mint = new PublicKey(params.mint);
    const ata = deriveFollowerVaultAta(mint, vaultAuthority);
    const provider = await this.anchorClient.getProvider();
    let rawAmount = '0';
    let uiAmount = 0;
    let decimals = 0;
    let exists = false;
    try {
      const info = await provider.connection.getTokenAccountBalance(ata, 'confirmed');
      rawAmount = info.value.amount;
      uiAmount = info.value.uiAmount ?? 0;
      decimals = info.value.decimals;
      exists = true;
    } catch (err) {
      // Account may not exist yet — that's a valid empty balance, not an error.
      this.logger.debug(
        `readVaultTokenBalance: ATA ${ata.toBase58()} not yet funded (${
          err instanceof Error ? err.message : err
        })`,
      );
      // Best-effort decimals lookup so the UI can still format zero balances.
      try {
        const mintInfo = await provider.connection.getParsedAccountInfo(mint, 'confirmed');
        const parsed = (mintInfo.value?.data as { parsed?: { info?: { decimals?: number } } })
          ?.parsed?.info?.decimals;
        if (typeof parsed === 'number') decimals = parsed;
      } catch {
        // fall through with decimals = 0
      }
    }
    return {
      vaultAuthorityPda: params.vaultAuthorityPda,
      vaultTokenAccount: ata.toBase58(),
      mint: params.mint,
      rawAmount,
      uiAmount,
      decimals,
      exists,
    };
  }

  private async encodeUnsigned(
    ix: TransactionInstruction,
  ): Promise<FollowerOnchainInstructionResult> {
    let recentBlockhash: string | null = null;
    try {
      const provider = await this.anchorClient.getProvider();
      const latest = await provider.connection.getLatestBlockhash('confirmed');
      recentBlockhash = latest.blockhash;
    } catch {
      // best-effort; clients can fetch their own blockhash if missing
    }
    return {
      signature: null,
      unsignedInstructionBase64: this.encodeInstructionPayload(ix),
      recentBlockhash,
    };
  }

  private encodeInstructionPayload(ix: TransactionInstruction): string {
    const payload = {
      programId: ix.programId.toBase58(),
      keys: ix.keys.map((k) => ({
        pubkey: k.pubkey.toBase58(),
        isSigner: k.isSigner,
        isWritable: k.isWritable,
      })),
      data: Buffer.from(ix.data).toString('base64'),
    };
    return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
  }

  private uuidArray(uuid: string): number[] {
    return Array.from(uuidToBytes(uuid));
  }

  private isAccountAlreadyExistsError(err: unknown): boolean {
    const msg = err instanceof Error ? err.message : String(err);
    return /already in use|0x0$|already initialized/i.test(msg);
  }

  /**
   * Detects program errors raised when the lifecycle is already in the
   * requested state (or in a later state that disallows the transition).
   * The on-chain program returns a custom error code; we match it loosely
   * against common phrasings to keep the adapter resilient to message
   * tweaks. Used to make `initializeDeployment` idempotent on retry.
   */
  private isLifecycleAlreadySetError(err: unknown): boolean {
    const msg = err instanceof Error ? err.message : String(err);
    return /invalid.*lifecycle|lifecycle.*transition|already deployed|invalid.*transition/i.test(
      msg,
    );
  }

  // ---------- Phase 4 — application-layer closure ----------

  async collectFees(params: {
    deploymentId: string;
  }): Promise<{ signature: string | null; collectedLamports: number }> {
    const program = await this.anchorClient.getProgram();
    const programId = this.anchorClient.getProgramId();
    const provider = await this.anchorClient.getProvider();
    const creator = provider.wallet.publicKey;

    const [deploymentPda] = deriveDeploymentPda(programId, params.deploymentId);
    const [vaultAuthorityPda] = deriveVaultAuthorityPda(programId, deploymentPda);

    try {
      // Pre-fetch lamports to report how much was collected
      const preAccountInfo = await provider.connection.getAccountInfo(
        vaultAuthorityPda,
        'confirmed',
      );
      const preLamports = preAccountInfo?.lamports ?? 0;

      const methods = program.methods as unknown as Record<string, (...args: unknown[]) => any>;
      const sig = await methods
        .collectFees()
        .accountsPartial({
          creator,
          deployment: deploymentPda,
          vaultAuthority: vaultAuthorityPda,
        })
        .rpc();

      const postAccountInfo = await provider.connection.getAccountInfo(
        vaultAuthorityPda,
        'confirmed',
      );
      const postLamports = postAccountInfo?.lamports ?? 0;
      const collected = Math.max(0, preLamports - postLamports);

      return { signature: sig, collectedLamports: collected };
    } catch (err) {
      throw this.toInternalError('collectFees', err);
    }
  }

  async emergencyPause(params: { deploymentId: string }): Promise<{ signature: string | null }> {
    const program = await this.anchorClient.getProgram();
    const programId = this.anchorClient.getProgramId();
    const provider = await this.anchorClient.getProvider();
    const authority = provider.wallet.publicKey;

    const [deploymentPda] = deriveDeploymentPda(programId, params.deploymentId);
    const [strategyStatePda] = deriveStrategyStatePda(programId, deploymentPda);

    try {
      const methods = program.methods as unknown as Record<string, (...args: unknown[]) => any>;
      const sig = await methods
        .emergencyPause()
        .accountsPartial({
          authority,
          deployment: deploymentPda,
          strategyState: strategyStatePda,
        })
        .rpc();
      return { signature: sig };
    } catch (err) {
      throw this.toInternalError('emergencyPause', err);
    }
  }

  async emergencyResume(params: { deploymentId: string }): Promise<{ signature: string | null }> {
    const program = await this.anchorClient.getProgram();
    const programId = this.anchorClient.getProgramId();
    const provider = await this.anchorClient.getProvider();
    const authority = provider.wallet.publicKey;

    const [deploymentPda] = deriveDeploymentPda(programId, params.deploymentId);
    const [strategyStatePda] = deriveStrategyStatePda(programId, deploymentPda);

    try {
      const methods = program.methods as unknown as Record<string, (...args: unknown[]) => any>;
      const sig = await methods
        .emergencyResume()
        .accountsPartial({
          authority,
          deployment: deploymentPda,
          strategyState: strategyStatePda,
        })
        .rpc();
      return { signature: sig };
    } catch (err) {
      throw this.toInternalError('emergencyResume', err);
    }
  }

  // ---------- Keeper + delegation management ----------

  async setKeeper(params: SetKeeperParams): Promise<{ signature: string | null }> {
    const program = await this.anchorClient.getProgram();
    const programId = this.anchorClient.getProgramId();
    const provider = await this.anchorClient.getProvider();
    const creator = provider.wallet.publicKey;

    const [deploymentPda] = deriveDeploymentPda(programId, params.deploymentId);
    const newKeeper = params.newKeeperWallet
      ? new PublicKey(params.newKeeperWallet)
      : PublicKey.default;

    try {
      const sig = await program.methods
        .setKeeper(newKeeper)
        .accountsPartial({
          creator,
          deployment: deploymentPda,
        })
        .rpc();
      return { signature: sig };
    } catch (err) {
      throw this.toInternalError('setKeeper', err);
    }
  }

  async closeVaultAuthority(
    params: CloseVaultAuthorityParams,
  ): Promise<{ signature: string | null }> {
    const program = await this.anchorClient.getProgram();
    const programId = this.anchorClient.getProgramId();
    const provider = await this.anchorClient.getProvider();
    const creator = provider.wallet.publicKey;

    const [deploymentPda] = deriveDeploymentPda(programId, params.deploymentId);
    const [vaultAuthorityPda] = deriveVaultAuthorityPda(programId, deploymentPda);

    try {
      const methods = program.methods as unknown as Record<string, (...args: unknown[]) => any>;
      const sig = await methods
        .closeVaultAuthority()
        .accountsPartial({
          creator,
          deployment: deploymentPda,
          vaultAuthority: vaultAuthorityPda,
        })
        .rpc();
      return { signature: sig };
    } catch (err) {
      throw this.toInternalError('closeVaultAuthority', err);
    }
  }

  async closePublicSnapshot(
    params: ClosePublicSnapshotParams,
  ): Promise<{ signature: string | null }> {
    const program = await this.anchorClient.getProgram();
    const programId = this.anchorClient.getProgramId();
    const provider = await this.anchorClient.getProvider();
    const creator = provider.wallet.publicKey;

    const [deploymentPda] = deriveDeploymentPda(programId, params.deploymentId);
    const [publicSnapshotPda] = derivePublicSnapshotPda(programId, deploymentPda);

    try {
      const methods = program.methods as unknown as Record<string, (...args: unknown[]) => any>;
      const sig = await methods
        .closePublicSnapshot()
        .accountsPartial({
          creator,
          deployment: deploymentPda,
          publicSnapshot: publicSnapshotPda,
        })
        .rpc();
      return { signature: sig };
    } catch (err) {
      throw this.toInternalError('closePublicSnapshot', err);
    }
  }

  async delegateStrategyStateToEr(
    params: DelegateStrategyStateToErParams,
  ): Promise<{ signature: string | null }> {
    const program = await this.anchorClient.getProgram();
    const programId = this.anchorClient.getProgramId();
    const provider = await this.anchorClient.getProvider();
    const creator = provider.wallet.publicKey;

    const [deploymentPda] = deriveDeploymentPda(programId, params.deploymentId);
    const [strategyStatePda] = deriveStrategyStatePda(programId, deploymentPda);

    const validator = new PublicKey(params.validatorWallet);

    try {
      const sig = await program.methods
        .delegateStrategyState(validator, params.commitFrequencyMs)
        .accountsPartial({
          creator,
          deployment: deploymentPda,
          strategyState: strategyStatePda,
        })
        .rpc();
      return { signature: sig };
    } catch (err) {
      throw this.toInternalError('delegateStrategyStateToEr', err);
    }
  }

  private toInternalError(label: string, err: unknown): InternalServerErrorException {
    const msg = err instanceof Error ? err.message : String(err);
    this.logger.error(`Anchor adapter ${label} failed: ${msg}`);
    return new InternalServerErrorException(`onchain ${label} failed: ${msg}`);
  }
}
