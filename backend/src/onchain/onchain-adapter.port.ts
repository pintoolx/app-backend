/**
 * Onchain Adapter Port — abstraction for the strategy_runtime Anchor program.
 *
 * Week 2 ships only a Noop implementation so business logic can be exercised
 * end-to-end without touching the chain. Week 3 introduces an Anchor-backed
 * implementation that signs and submits real transactions; consumers should
 * remain unchanged.
 */
export const ONCHAIN_ADAPTER = Symbol('OnchainAdapterPort');

export type DeploymentLifecycleStatus = 'draft' | 'deployed' | 'paused' | 'stopped' | 'closed';

export type DeploymentExecutionMode = 'offchain' | 'er' | 'per';

export interface InitializeDeploymentParams {
  deploymentId: string;
  strategyId: string;
  strategy_version: number;
  creatorWallet: string;
  vaultOwnerHint: string | null;
  publicMetadataHash: string;
  privateDefinitionCommitment: string;
  executionMode: DeploymentExecutionMode;
}

export interface InitializeDeploymentResult {
  deploymentAccount: string | null;
  vaultAuthorityAccount: string | null;
  strategyStateAccount: string | null;
  publicSnapshotAccount: string | null;
  signature: string | null;
}

export interface SetLifecycleStatusParams {
  deploymentId: string;
  newStatus: DeploymentLifecycleStatus;
}

export interface CommitStateParams {
  deploymentId: string;
  expectedRevision: number;
  newPrivateStateCommitment: string;
  lastResultCode: number;
}

export interface SetPublicSnapshotParams {
  deploymentId: string;
  expectedSnapshotRevision: number;
  status: string;
  pnlSummaryBps: number | null;
  riskBand: string | null;
  publicMetricsHash: string;
}

export interface CloseDeploymentParams {
  deploymentId: string;
}

export interface SetKeeperParams {
  deploymentId: string;
  /** Base58 keeper pubkey. Pass `null` to revert to creator-only mode (Pubkey::default()). */
  newKeeperWallet: string | null;
}

export interface CloseVaultAuthorityParams {
  deploymentId: string;
}

export interface ClosePublicSnapshotParams {
  deploymentId: string;
}

export interface DelegateStrategyStateToErParams {
  deploymentId: string;
  /** ER validator pubkey (base58). */
  validatorWallet: string;
  /** Commit frequency in milliseconds (e.g. 5000). */
  commitFrequencyMs: number;
}

export interface OnchainCommitResult {
  signature: string | null;
  newStateRevision: number;
}

export interface BuildCommitStateTransactionResult {
  /** Base64-encoded signed transaction ready for Magic Router forwarding. */
  transactionBase64: string;
}

// ---------------- Phase 2: follower-vault provisioning ---------------------

/**
 * Derived PDAs for a follower subscription. The bumps are returned so the
 * provisioning layer can persist them and verify on-chain accounts later
 * without re-running findProgramAddressSync.
 *
 * The Noop adapter computes real PDAs even when no chain is wired — this is
 * how Phase 2 eliminates `placeholder-` prefixes.
 */
export interface FollowerPdaSet {
  subscriptionPda: string;
  subscriptionPdaBump: number;
  followerVaultPda: string;
  followerVaultPdaBump: number;
  vaultAuthorityPda: string;
  vaultAuthorityPdaBump: number;
}

export interface DeriveFollowerPdasParams {
  deploymentId: string;
  followerWallet: string;
}

export type FollowerVaultLifecycleStatus =
  | 'pending_funding'
  | 'active'
  | 'paused'
  | 'exiting'
  | 'closed';

export type FollowerCustodyMode = 'program_owned' | 'self_custody';

export interface InitializeFollowerSubscriptionParams {
  deploymentId: string;
  followerWallet: string;
  /** UUID of the strategy_subscriptions row — used as 16-byte PDA arg. */
  subscriptionId: string;
}

export interface InitializeFollowerVaultParams {
  subscriptionPda: string;
  followerWallet: string;
  /** UUID of the follower_vaults row — used as 16-byte PDA arg. */
  vaultId: string;
  custodyMode: FollowerCustodyMode;
}

export interface InitializeFollowerVaultAuthorityParams {
  followerVaultPda: string;
  followerWallet: string;
}

export interface SetFollowerVaultStatusParams {
  followerVaultPda: string;
  subscriptionPda: string;
  followerWallet: string;
  lifecycleStatus: FollowerVaultLifecycleStatus;
}

export interface CloseFollowerVaultParams {
  followerVaultPda: string;
  authorityPda: string;
  subscriptionPda: string;
  followerWallet: string;
}

/**
 * Result of a follower-vault provisioning instruction. `signature` is non-null
 * only when the adapter actually submitted a transaction (i.e. when a follower
 * Keypair is available locally). Otherwise the adapter returns the unsigned
 * instruction encoded as base64 so the caller can dispatch it through the
 * follower's wallet (Crossmint / external) for signing.
 */
export interface FollowerOnchainInstructionResult {
  signature: string | null;
  /**
   * Base64-encoded serialized TransactionInstruction — the caller can wrap it
   * into a v0 transaction, attach a recent blockhash, and request the
   * follower's signature. NULL when the adapter signed and submitted itself.
   */
  unsignedInstructionBase64: string | null;
  /** Recently-fetched blockhash hint to help the wallet skip a roundtrip. */
  recentBlockhash?: string | null;
}

export interface BuildFundIntentInstructionParams {
  vaultAuthorityPda: string;
  /** Base mint address. Use the SOL pseudo-mint for native deposits. */
  mint: string;
  /** Raw amount in smallest-unit of mint (string → bigint). */
  amount: string;
  /** Funder wallet — needs to sign the resulting tx. */
  fromWallet: string;
}

export interface ReadVaultTokenBalanceParams {
  vaultAuthorityPda: string;
  mint: string;
}

export interface BuildAdjustSubscriptionParamsInstructionParams {
  subscriptionPda: string;
  followerWallet: string;
  expectedRevision: string;
  /** 32-byte hex commitment over the off-chain subscriber-level config blob. */
  newConfigCommitmentHex: string;
}

export interface BuildWithdrawInstructionParams {
  subscriptionPda: string;
  followerVaultPda: string;
  vaultAuthorityPda: string;
  followerWallet: string;
  mint: string;
  /** Raw amount in smallest-unit (string → u64). */
  amount: string;
}

export interface WithdrawInstruction {
  /** Base64-encoded serialized TransactionInstruction for the follower to sign. */
  instructionBase64: string;
  recentBlockhash: string | null;
  vaultTokenAccount: string;
  /** Follower's ATA for the mint — destination of the withdrawal. */
  followerTokenAccount: string;
  amount: string;
}

export interface VaultTokenBalance {
  vaultAuthorityPda: string;
  vaultTokenAccount: string | null;
  mint: string;
  /** Raw amount in smallest-unit (stringified u64) — `"0"` if account doesn't exist. */
  rawAmount: string;
  uiAmount: number;
  decimals: number;
  /** True if the ATA exists on-chain right now. */
  exists: boolean;
}

export interface FundIntentInstruction {
  /** Base64-encoded serialized TransactionInstruction. */
  instructionBase64: string;
  /** Recent blockhash if the adapter has a Solana RPC available. */
  recentBlockhash: string | null;
  /** Echoed for human-readable display. */
  vaultAuthorityPda: string;
  mint: string;
  amount: string;
  /**
   * Associated token account owned by `vaultAuthorityPda` for `mint`. This
   * is the destination the on-chain `fund_follower_vault` instruction
   * deposits into and the source `withdraw_from_vault` pulls from.
   * `null` if mint is the SOL pseudo-mint (transfers go to the PDA's
   * lamport balance directly).
   */
  vaultTokenAccount: string | null;
}

export interface OnchainAdapterPort {
  initializeDeployment(params: InitializeDeploymentParams): Promise<InitializeDeploymentResult>;
  setLifecycleStatus(params: SetLifecycleStatusParams): Promise<{ signature: string | null }>;
  commitState(params: CommitStateParams): Promise<OnchainCommitResult>;
  /**
   * Build a signed commitState transaction for MagicBlock ER routing.
   * The adapter constructs the Anchor instruction, attaches a recent blockhash,
   * signs with the keeper wallet, and returns the serialized tx as base64.
   */
  buildCommitStateTransaction(
    params: CommitStateParams,
  ): Promise<BuildCommitStateTransactionResult>;
  setPublicSnapshot(params: SetPublicSnapshotParams): Promise<OnchainCommitResult>;
  closeDeployment(params: CloseDeploymentParams): Promise<{ signature: string | null }>;

  // Phase-2 follower-vault provisioning ------------------------------------
  deriveFollowerPdas(params: DeriveFollowerPdasParams): Promise<FollowerPdaSet>;
  initializeFollowerSubscription(
    params: InitializeFollowerSubscriptionParams,
  ): Promise<FollowerOnchainInstructionResult>;
  initializeFollowerVault(
    params: InitializeFollowerVaultParams,
  ): Promise<FollowerOnchainInstructionResult>;
  initializeFollowerVaultAuthority(
    params: InitializeFollowerVaultAuthorityParams,
  ): Promise<FollowerOnchainInstructionResult>;
  setFollowerVaultStatus(
    params: SetFollowerVaultStatusParams,
  ): Promise<FollowerOnchainInstructionResult>;
  closeFollowerVault(params: CloseFollowerVaultParams): Promise<FollowerOnchainInstructionResult>;
  buildFundIntentInstruction(
    params: BuildFundIntentInstructionParams,
  ): Promise<FundIntentInstruction>;
  readVaultTokenBalance(params: ReadVaultTokenBalanceParams): Promise<VaultTokenBalance>;
  buildAdjustSubscriptionParamsInstruction(
    params: BuildAdjustSubscriptionParamsInstructionParams,
  ): Promise<FollowerOnchainInstructionResult>;
  buildWithdrawInstruction(params: BuildWithdrawInstructionParams): Promise<WithdrawInstruction>;

  // Phase 4 — application-layer closure ------------------------------------
  collectFees(params: {
    deploymentId: string;
  }): Promise<{ signature: string | null; collectedLamports: number }>;
  emergencyPause(params: { deploymentId: string }): Promise<{ signature: string | null }>;
  emergencyResume(params: { deploymentId: string }): Promise<{ signature: string | null }>;

  // Keeper + delegation management -----------------------------------------
  setKeeper(params: SetKeeperParams): Promise<{ signature: string | null }>;
  closeVaultAuthority(params: CloseVaultAuthorityParams): Promise<{ signature: string | null }>;
  closePublicSnapshot(params: ClosePublicSnapshotParams): Promise<{ signature: string | null }>;
  delegateStrategyStateToEr(
    params: DelegateStrategyStateToErParams,
  ): Promise<{ signature: string | null }>;
}
