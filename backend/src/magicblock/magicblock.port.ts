/**
 * MagicBlock Adapter Ports — reserved space for ER, PER, and Private Payments.
 *
 * Week 2 ships only Noop implementations so the deployment / treasury
 * pipelines can boot without external SDK availability. Week 4 introduces a
 * real ER adapter, Week 5 introduces real PER and Private Payments adapters.
 */
export const MAGICBLOCK_ER_ADAPTER = Symbol('MagicBlockErAdapterPort');
export const MAGICBLOCK_PER_ADAPTER = Symbol('MagicBlockPerAdapterPort');
export const MAGICBLOCK_PRIVATE_PAYMENTS_ADAPTER = Symbol('MagicBlockPrivatePaymentsAdapterPort');

// ---------- ER (Ephemeral Rollups) ----------

export interface ErDelegateParams {
  deploymentId: string;
  accountPubkey: string;
}

export interface ErDelegateResult {
  sessionId: string | null;
  signature: string | null;
}

export interface ErRouteParams {
  deploymentId: string;
  base64Tx: string;
}

export interface ErRouteResult {
  signature: string | null;
  routedThrough: 'er' | 'mainnet' | 'noop';
}

export interface ErCommitAndUndelegateParams {
  deploymentId: string;
  accountPubkey: string;
}

export interface MagicBlockErAdapterPort {
  delegateAccount(params: ErDelegateParams): Promise<ErDelegateResult>;
  route(params: ErRouteParams): Promise<ErRouteResult>;
  commitAndUndelegate(params: ErCommitAndUndelegateParams): Promise<{ signature: string | null }>;
}

// ---------- PER (Private Ephemeral Rollups) ----------

export type PerMemberRole = 'creator' | 'operator' | 'viewer' | 'subscriber' | 'auditor';

export interface PerCreateGroupParams {
  deploymentId: string;
  members: Array<{ wallet: string; role: PerMemberRole }>;
}

export interface PerCreateGroupResult {
  groupId: string | null;
  signature: string | null;
}

export interface PerAuthChallengeParams {
  deploymentId: string;
  walletAddress: string;
}

export interface PerAuthChallenge {
  challenge: string;
  expiresAt: string;
}

export interface PerAuthVerifyParams {
  deploymentId: string;
  walletAddress: string;
  challenge: string;
  signature: string;
}

export interface PerAuthVerifyResult {
  authToken: string;
  expiresAt: string;
}

export interface PerPrivateStateParams {
  deploymentId: string;
  authToken: string;
}

export interface PerPrivateStateResult {
  state: Record<string, unknown> | null;
  logs: Array<Record<string, unknown>>;
}

export interface MagicBlockPerAdapterPort {
  createPermissionGroup(params: PerCreateGroupParams): Promise<PerCreateGroupResult>;
  requestAuthChallenge(params: PerAuthChallengeParams): Promise<PerAuthChallenge>;
  verifyAuthSignature(params: PerAuthVerifyParams): Promise<PerAuthVerifyResult>;
  getPrivateState(params: PerPrivateStateParams): Promise<PerPrivateStateResult>;
}

// ---------- Private Payments API ----------

export interface PrivatePaymentsDepositParams {
  deploymentId: string;
  fromWallet: string;
  mint: string;
  amount: string;
}

export interface PrivatePaymentsTransferParams {
  deploymentId: string;
  fromWallet: string;
  toWallet: string;
  mint: string;
  amount: string;
}

export interface PrivatePaymentsWithdrawParams {
  deploymentId: string;
  toWallet: string;
  mint: string;
  amount: string;
}

export interface PrivatePaymentsBalanceParams {
  deploymentId: string;
  wallet: string;
  mint: string;
}

export interface PrivatePaymentsResult {
  signature: string | null;
  status: 'pending' | 'confirmed' | 'failed';
  encryptedBalanceRef: string | null;
}

export interface MagicBlockPrivatePaymentsAdapterPort {
  deposit(params: PrivatePaymentsDepositParams): Promise<PrivatePaymentsResult>;
  transfer(params: PrivatePaymentsTransferParams): Promise<PrivatePaymentsResult>;
  withdraw(params: PrivatePaymentsWithdrawParams): Promise<PrivatePaymentsResult>;
  getBalance(
    params: PrivatePaymentsBalanceParams,
  ): Promise<{ encryptedBalanceRef: string | null; ciphertext: string | null }>;
}
