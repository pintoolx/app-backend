/**
 * Umbra Treasury Adapter Port — reserved space for Encrypted Token Account
 * registration, shielded deposit / withdraw / transfer, and viewer grants.
 *
 * v2 (SDK rewrite): Backed by @umbra-privacy/sdk with the platform keeper
 * keypair as the Umbra signer. All key derivation is handled internally by
 * the SDK via wallet-signed consent message (KMAC256). No static master seed
 * env var is needed.
 */
export const UMBRA_ADAPTER = Symbol('UmbraAdapterPort');

export type UmbraRegistrationMode = 'confidential' | 'anonymous';

/**
 * Optional override for the signing identity used by an Umbra operation.
 *
 * Phase 1 follower-vault privacy uses one HKDF-derived Ed25519 keypair per
 * follower vault so that vault treasuries don't share an Umbra identity. The
 * override is passed in per call to avoid mutating module-wide state on the
 * shared `UmbraClientService`.
 *
 * `secretKey` is a 64-byte Solana keypair secret. The Noop adapter ignores
 * the override; the Real adapter (when implemented end-to-end) is expected to
 * temporarily mount this signer for the SDK call.
 */
export interface UmbraSignerOverride {
  secretKey: Uint8Array;
  pubkey: string;
}

export interface UmbraRegisterParams {
  walletAddress: string;
  mode: UmbraRegistrationMode;
  signerOverride?: UmbraSignerOverride;
}

export interface UmbraRegisterResult {
  encryptedUserAccount: string | null;
  x25519PublicKey: string | null;
  signerPubkey: string | null;
  txSignatures: string[];
  status: 'confirmed' | 'failed';
}

export interface UmbraDepositParams {
  deploymentId: string;
  fromWallet: string;
  mint: string;
  amount: string;
  signerOverride?: UmbraSignerOverride;
}

export interface UmbraWithdrawParams {
  deploymentId: string;
  toWallet: string;
  mint: string;
  amount: string;
  signerOverride?: UmbraSignerOverride;
}

export interface UmbraTransferParams {
  deploymentId: string;
  fromWallet: string;
  toWallet: string;
  mint: string;
  amount: string;
  signerOverride?: UmbraSignerOverride;
}

export interface UmbraTreasuryResult {
  queueSignature: string | null;
  callbackSignature: string | null;
  status: 'pending' | 'confirmed' | 'failed';
}

export interface UmbraEncryptedBalanceParams {
  deploymentId: string;
  walletAddress: string;
  mint: string;
  signerOverride?: UmbraSignerOverride;
}

export interface UmbraEncryptedBalance {
  encryptedTokenAccount: string | null;
  ciphertext: string | null;
  decryptedAmount: string | null;
}

export interface UmbraGrantViewerParams {
  deploymentId: string;
  granteeWallet: string;
  mint: string;
  expiresAt?: string;
}

export interface UmbraGrantResult {
  grantId: string | null;
  payload: Record<string, unknown>;
}

export interface UmbraAdapterPort {
  registerEncryptedUserAccount(params: UmbraRegisterParams): Promise<UmbraRegisterResult>;
  deposit(params: UmbraDepositParams): Promise<UmbraTreasuryResult>;
  withdraw(params: UmbraWithdrawParams): Promise<UmbraTreasuryResult>;
  transfer(params: UmbraTransferParams): Promise<UmbraTreasuryResult>;
  getEncryptedBalance(params: UmbraEncryptedBalanceParams): Promise<UmbraEncryptedBalance>;
  grantViewer(params: UmbraGrantViewerParams): Promise<UmbraGrantResult>;
}
