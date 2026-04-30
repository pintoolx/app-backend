import { Injectable, Logger, InternalServerErrorException } from '@nestjs/common';
import { BN } from '@anchor-lang/core';
import { PublicKey, SystemProgram, TransactionInstruction } from '@solana/web3.js';
import { AnchorClientService } from './anchor-client.service';
import {
  type BuildFundIntentInstructionParams,
  type CloseDeploymentParams,
  type CloseFollowerVaultParams,
  type CommitStateParams,
  type DeriveFollowerPdasParams,
  type DeploymentLifecycleStatus,
  type DeploymentExecutionMode,
  type FollowerOnchainInstructionResult,
  type FollowerPdaSet,
  type FollowerVaultLifecycleStatus,
  type FundIntentInstruction,
  type InitializeDeploymentParams,
  type InitializeDeploymentResult,
  type InitializeFollowerSubscriptionParams,
  type InitializeFollowerVaultAuthorityParams,
  type InitializeFollowerVaultParams,
  type OnchainAdapterPort,
  type OnchainCommitResult,
  type SetFollowerVaultStatusParams,
  type SetLifecycleStatusParams,
  type SetPublicSnapshotParams,
} from './onchain-adapter.port';
import {
  deriveDeploymentPda,
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

const FOLLOWER_LIFECYCLE_TO_CODE: Record<FollowerVaultLifecycleStatus, number> = {
  pending_funding: 0,
  active: 1,
  paused: 2,
  exiting: 3,
  closed: 4,
};

const CUSTODY_MODE_TO_CODE: Record<
  'program_owned' | 'self_custody' | 'private_payments_relay',
  number
> = {
  program_owned: 0,
  self_custody: 1,
  private_payments_relay: 2,
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

  constructor(private readonly anchorClient: AnchorClientService) {}

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
      params.strategyVersion,
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
          params.strategyVersion,
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
      throw this.toInternalError('initializeDeployment', err);
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
      throw this.toInternalError('initializeVaultAuthority', err);
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
      throw this.toInternalError('initializeStrategyState', err);
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
      throw this.toInternalError('setLifecycleStatus(deployed)', err);
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
    return {
      instructionBase64: this.encodeInstructionPayload(ix),
      recentBlockhash,
      vaultAuthorityPda: params.vaultAuthorityPda,
      mint: params.mint,
      amount: params.amount,
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

  // ---------- Phase 4 — application-layer closure ----------

  async collectFees(params: { deploymentId: string }): Promise<{ signature: string | null; collectedLamports: number }> {
    const program = await this.anchorClient.getProgram();
    const programId = this.anchorClient.getProgramId();
    const provider = await this.anchorClient.getProvider();
    const creator = provider.wallet.publicKey;

    const [deploymentPda] = deriveDeploymentPda(programId, params.deploymentId);
    const [vaultAuthorityPda] = deriveVaultAuthorityPda(programId, deploymentPda);

    try {
      // Pre-fetch lamports to report how much was collected
      const preAccountInfo = await provider.connection.getAccountInfo(vaultAuthorityPda, 'confirmed');
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

      const postAccountInfo = await provider.connection.getAccountInfo(vaultAuthorityPda, 'confirmed');
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

  private toInternalError(label: string, err: unknown): InternalServerErrorException {
    const msg = err instanceof Error ? err.message : String(err);
    this.logger.error(`Anchor adapter ${label} failed: ${msg}`);
    return new InternalServerErrorException(`onchain ${label} failed: ${msg}`);
  }
}
