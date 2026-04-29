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
  strategyVersion: number;
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

export interface OnchainCommitResult {
  signature: string | null;
  newStateRevision: number;
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

export type FollowerCustodyMode = 'program_owned' | 'self_custody' | 'private_payments_relay';

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

export interface FundIntentInstruction {
  /** Base64-encoded serialized TransactionInstruction. */
  instructionBase64: string;
  /** Recent blockhash if the adapter has a Solana RPC available. */
  recentBlockhash: string | null;
  /** Echoed for human-readable display. */
  vaultAuthorityPda: string;
  mint: string;
  amount: string;
}

export interface OnchainAdapterPort {
  initializeDeployment(params: InitializeDeploymentParams): Promise<InitializeDeploymentResult>;
  setLifecycleStatus(params: SetLifecycleStatusParams): Promise<{ signature: string | null }>;
  commitState(params: CommitStateParams): Promise<OnchainCommitResult>;
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
  closeFollowerVault(
    params: CloseFollowerVaultParams,
  ): Promise<FollowerOnchainInstructionResult>;
  buildFundIntentInstruction(
    params: BuildFundIntentInstructionParams,
  ): Promise<FundIntentInstruction>;
}
