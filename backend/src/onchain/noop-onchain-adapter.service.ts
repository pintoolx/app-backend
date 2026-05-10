import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PublicKey, SystemProgram, TransactionInstruction } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from '@solana/spl-token';
import {
  type BuildFundIntentInstructionParams,
  type BuildWithdrawInstructionParams,
  type CloseDeploymentParams,
  type CloseFollowerVaultParams,
  type ClosePublicSnapshotParams,
  type CloseVaultAuthorityParams,
  type CommitStateParams,
  type DelegateStrategyStateToErParams,
  type DeriveFollowerPdasParams,
  type FollowerOnchainInstructionResult,
  type FollowerPdaSet,
  type BuildAdjustSubscriptionParamsInstructionParams,
  type FundIntentInstruction,
  type ReadVaultTokenBalanceParams,
  type VaultTokenBalance,
  type InitializeDeploymentParams,
  type InitializeDeploymentResult,
  type InitializeFollowerSubscriptionParams,
  type InitializeFollowerVaultAuthorityParams,
  type InitializeFollowerVaultParams,
  type OnchainAdapterPort,
  type OnchainCommitResult,
  type SetFollowerVaultStatusParams,
  type SetKeeperParams,
  type SetLifecycleStatusParams,
  type SetPublicSnapshotParams,
  type SubmitNodeInstructionParams,
  type SubmitNodeInstructionResult,
  type WithdrawInstruction,
} from './onchain-adapter.port';
import {
  deriveDeploymentPda,
  deriveFollowerVaultAta,
  deriveFollowerVaultAuthorityPda,
  deriveFollowerVaultPda,
  deriveSubscriptionPda,
} from './anchor/pda';
import idlJson from './anchor/strategy_runtime.json';

/**
 * Default Noop adapter used until the Anchor `strategy_runtime` program lands
 * in Week 3. All chain-mutating methods return null signatures and log at
 * debug level so the deployment lifecycle can be exercised without touching
 * the chain.
 *
 * Phase-2 update: even though we do not submit transactions, follower-vault
 * provisioning helpers compute **real** PDAs (using the program ID configured
 * in env, or the IDL-declared address as a deterministic fallback) so that
 * `placeholder-` prefixes no longer appear in the database. The Noop adapter
 * also returns a base64 SystemProgram.transfer instruction for fund-intent so
 * the wallet client can sign and submit even in dev environments.
 */
@Injectable()
export class NoopOnchainAdapter implements OnchainAdapterPort {
  private readonly logger = new Logger('NoopOnchainAdapter');

  constructor(private readonly configService?: ConfigService) {}

  getProgramId(): string {
    return this.resolveProgramId().toBase58();
  }

  async submitNodeInstruction(
    params: SubmitNodeInstructionParams,
  ): Promise<SubmitNodeInstructionResult> {
    this.logger.debug(
      `[noop] submitNodeInstruction node=${params.nodeType} program=${params.programId} accounts=${params.accounts.length}`,
    );
    return { signature: null };
  }

  async initializeDeployment(
    params: InitializeDeploymentParams,
  ): Promise<InitializeDeploymentResult> {
    this.logger.debug(
      `[noop] initializeDeployment deployment=${params.deploymentId} strategy=${params.strategyId} version=${params.strategy_version} mode=${params.executionMode}`,
    );
    return {
      deploymentAccount: null,
      vaultAuthorityAccount: null,
      strategyStateAccount: null,
      publicSnapshotAccount: null,
      signature: null,
    };
  }

  async setLifecycleStatus(
    params: SetLifecycleStatusParams,
  ): Promise<{ signature: string | null }> {
    this.logger.debug(
      `[noop] setLifecycleStatus deployment=${params.deploymentId} status=${params.newStatus}`,
    );
    return { signature: null };
  }

  async commitState(params: CommitStateParams): Promise<OnchainCommitResult> {
    this.logger.debug(
      `[noop] commitState deployment=${params.deploymentId} expectedRevision=${params.expectedRevision}`,
    );
    return { signature: null, newStateRevision: params.expectedRevision + 1 };
  }

  async buildCommitStateTransaction(
    params: CommitStateParams,
  ): Promise<{ transactionBase64: string }> {
    this.logger.debug(
      `[noop] buildCommitStateTransaction deployment=${params.deploymentId} expectedRevision=${params.expectedRevision}`,
    );
    return {
      transactionBase64: `noop-commit-${params.deploymentId}-${params.expectedRevision}`,
    };
  }

  async setPublicSnapshot(params: SetPublicSnapshotParams): Promise<OnchainCommitResult> {
    this.logger.debug(
      `[noop] setPublicSnapshot deployment=${params.deploymentId} expectedSnapshot=${params.expectedSnapshotRevision}`,
    );
    return {
      signature: null,
      newStateRevision: params.expectedSnapshotRevision + 1,
    };
  }

  async closeDeployment(params: CloseDeploymentParams): Promise<{ signature: string | null }> {
    this.logger.debug(`[noop] closeDeployment deployment=${params.deploymentId}`);
    return { signature: null };
  }

  // -------------------------- Phase 2 follower-vault helpers ---------------

  async deriveFollowerPdas(params: DeriveFollowerPdasParams): Promise<FollowerPdaSet> {
    const programId = this.resolveProgramId();
    const followerKey = this.toPubkey(params.followerWallet, 'followerWallet');
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
    this.logger.debug(
      `[noop] initializeFollowerSubscription deployment=${params.deploymentId} follower=${params.followerWallet} subscription=${params.subscriptionId}`,
    );
    return { signature: null, unsignedInstructionBase64: null, recentBlockhash: null };
  }

  async initializeFollowerVault(
    params: InitializeFollowerVaultParams,
  ): Promise<FollowerOnchainInstructionResult> {
    this.logger.debug(
      `[noop] initializeFollowerVault subscription=${params.subscriptionPda} vault=${params.vaultId} custody=${params.custodyMode}`,
    );
    return { signature: null, unsignedInstructionBase64: null, recentBlockhash: null };
  }

  async initializeFollowerVaultAuthority(
    params: InitializeFollowerVaultAuthorityParams,
  ): Promise<FollowerOnchainInstructionResult> {
    this.logger.debug(`[noop] initializeFollowerVaultAuthority vault=${params.followerVaultPda}`);
    return { signature: null, unsignedInstructionBase64: null, recentBlockhash: null };
  }

  async setFollowerVaultStatus(
    params: SetFollowerVaultStatusParams,
  ): Promise<FollowerOnchainInstructionResult> {
    this.logger.debug(
      `[noop] setFollowerVaultStatus vault=${params.followerVaultPda} status=${params.lifecycleStatus}`,
    );
    return { signature: null, unsignedInstructionBase64: null, recentBlockhash: null };
  }

  async closeFollowerVault(
    params: CloseFollowerVaultParams,
  ): Promise<FollowerOnchainInstructionResult> {
    this.logger.debug(
      `[noop] closeFollowerVault vault=${params.followerVaultPda} authority=${params.authorityPda}`,
    );
    return { signature: null, unsignedInstructionBase64: null, recentBlockhash: null };
  }

  async collectFees(params: {
    deploymentId: string;
  }): Promise<{ signature: string | null; collectedLamports: number }> {
    this.logger.debug(`[noop] collectFees deployment=${params.deploymentId}`);
    return { signature: null, collectedLamports: 0 };
  }

  async emergencyPause(params: { deploymentId: string }): Promise<{ signature: string | null }> {
    this.logger.debug(`[noop] emergencyPause deployment=${params.deploymentId}`);
    return { signature: null };
  }

  async emergencyResume(params: { deploymentId: string }): Promise<{ signature: string | null }> {
    this.logger.debug(`[noop] emergencyResume deployment=${params.deploymentId}`);
    return { signature: null };
  }

  async setKeeper(params: SetKeeperParams): Promise<{ signature: string | null }> {
    this.logger.debug(
      `[noop] setKeeper deployment=${params.deploymentId} keeper=${params.newKeeperWallet ?? 'default'}`,
    );
    return { signature: null };
  }

  async closeVaultAuthority(
    params: CloseVaultAuthorityParams,
  ): Promise<{ signature: string | null }> {
    this.logger.debug(`[noop] closeVaultAuthority deployment=${params.deploymentId}`);
    return { signature: null };
  }

  async closePublicSnapshot(
    params: ClosePublicSnapshotParams,
  ): Promise<{ signature: string | null }> {
    this.logger.debug(`[noop] closePublicSnapshot deployment=${params.deploymentId}`);
    return { signature: null };
  }

  async delegateStrategyStateToEr(
    params: DelegateStrategyStateToErParams,
  ): Promise<{ signature: string | null }> {
    this.logger.debug(
      `[noop] delegateStrategyStateToEr deployment=${params.deploymentId} validator=${params.validatorWallet} freq=${params.commitFrequencyMs}`,
    );
    return { signature: null };
  }

  async buildFundIntentInstruction(
    params: BuildFundIntentInstructionParams,
  ): Promise<FundIntentInstruction> {
    // Defensive: bigint-cast amount up front so callers know if it's invalid.
    const lamports = BigInt(params.amount);
    const fromPub = this.toPubkey(params.fromWallet, 'fromWallet');
    const toPub = this.toPubkey(params.vaultAuthorityPda, 'vaultAuthorityPda');
    const ix: TransactionInstruction = SystemProgram.transfer({
      fromPubkey: fromPub,
      toPubkey: toPub,
      lamports,
    });
    const instructionBase64 = this.encodeInstruction(ix);
    let vaultTokenAccount: string | null = null;
    if (params.mint !== 'So11111111111111111111111111111111111111112') {
      try {
        vaultTokenAccount = deriveFollowerVaultAta(
          this.toPubkey(params.mint, 'mint'),
          toPub,
        ).toBase58();
      } catch {
        // best-effort
      }
    }
    return {
      instructionBase64,
      recentBlockhash: null,
      vaultAuthorityPda: params.vaultAuthorityPda,
      mint: params.mint,
      amount: params.amount,
      vaultTokenAccount,
    };
  }

  async buildAdjustSubscriptionParamsInstruction(
    _params: BuildAdjustSubscriptionParamsInstructionParams,
  ): Promise<FollowerOnchainInstructionResult> {
    // Noop adapter doesn't build a real instruction — return empty payload so
    // tests / dev environments can call the endpoint without an Anchor program.
    return {
      signature: null,
      unsignedInstructionBase64: null,
      recentBlockhash: null,
    };
  }

  async buildWithdrawInstruction(
    params: BuildWithdrawInstructionParams,
  ): Promise<WithdrawInstruction> {
    const followerKey = this.toPubkey(params.followerWallet, 'followerWallet');
    const vaultAuthorityKey = this.toPubkey(params.vaultAuthorityPda, 'vaultAuthorityPda');
    const mintKey = this.toPubkey(params.mint, 'mint');

    const vaultTokenAccount = deriveFollowerVaultAta(mintKey, vaultAuthorityKey);
    const followerTokenAccount = getAssociatedTokenAddressSync(
      mintKey,
      followerKey,
      false,
      TOKEN_PROGRAM_ID,
    );

    // Stub instruction — Noop adapter has no Anchor program loaded so we
    // can't build the real withdraw_from_vault discriminator. Encode a
    // placeholder payload so dev/tests can call the endpoint.
    const placeholder: TransactionInstruction = SystemProgram.transfer({
      fromPubkey: vaultAuthorityKey,
      toPubkey: followerKey,
      lamports: BigInt(params.amount),
    });

    return {
      instructionBase64: this.encodeInstruction(placeholder),
      recentBlockhash: null,
      vaultTokenAccount: vaultTokenAccount.toBase58(),
      followerTokenAccount: followerTokenAccount.toBase58(),
      amount: params.amount,
    };
  }

  async readVaultTokenBalance(params: ReadVaultTokenBalanceParams): Promise<VaultTokenBalance> {
    const vaultAuthority = this.toPubkey(params.vaultAuthorityPda, 'vaultAuthorityPda');
    const mint = this.toPubkey(params.mint, 'mint');
    const ata = deriveFollowerVaultAta(mint, vaultAuthority);
    return {
      vaultAuthorityPda: params.vaultAuthorityPda,
      vaultTokenAccount: ata.toBase58(),
      mint: params.mint,
      rawAmount: '0',
      uiAmount: 0,
      decimals: 0,
      exists: false,
    };
  }

  // ----------------------------------------------------------------- helpers

  private resolveProgramId(): PublicKey {
    const fromEnv = this.configService?.get<string>('STRATEGY_RUNTIME_PROGRAM_ID');
    if (fromEnv && fromEnv.trim().length > 0) {
      try {
        return new PublicKey(fromEnv.trim());
      } catch {
        // fall through to IDL fallback
      }
    }
    // IDL declares the canonical program ID at strategy_runtime.json:2.
    const idlAddress = (idlJson as unknown as { address?: string }).address;
    if (!idlAddress) {
      throw new Error('Cannot resolve strategy_runtime program ID for PDA derivation');
    }
    return new PublicKey(idlAddress);
  }

  private toPubkey(value: string, field: string): PublicKey {
    try {
      return new PublicKey(value);
    } catch (err) {
      throw new Error(`Invalid ${field} pubkey "${value}": ${(err as Error).message}`);
    }
  }

  private encodeInstruction(ix: TransactionInstruction): string {
    // We encode the *instruction* fields (programId / keys / data) as JSON,
    // not a full transaction, because the Noop path does not have a recent
    // blockhash. Clients reconstruct the TransactionInstruction.
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
}
