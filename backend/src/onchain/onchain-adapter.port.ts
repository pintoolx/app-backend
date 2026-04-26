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

export interface OnchainAdapterPort {
  initializeDeployment(params: InitializeDeploymentParams): Promise<InitializeDeploymentResult>;
  setLifecycleStatus(params: SetLifecycleStatusParams): Promise<{ signature: string | null }>;
  commitState(params: CommitStateParams): Promise<OnchainCommitResult>;
  setPublicSnapshot(params: SetPublicSnapshotParams): Promise<OnchainCommitResult>;
  closeDeployment(params: CloseDeploymentParams): Promise<{ signature: string | null }>;
}
