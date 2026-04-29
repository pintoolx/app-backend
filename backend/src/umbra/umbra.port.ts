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

// ---------------- Phase-5: claimable-UTXO transfer model ------------------
//
// `@umbra-privacy/sdk@4.0.0` does not expose a synchronous `transfer()` -
// confidential value movement uses the claimable-UTXO model:
//
//   1. sender calls `getEncryptedBalanceToReceiverClaimableUtxoCreatorFunction`
//      to publish a claimable UTXO -> we model that as
//      `createEncryptedTransferIntent`.
//   2. recipient (or a server-side relayer holding the recipient signer)
//      claims the UTXO via the SDK's claim flow -> modelled as
//      `claimEncryptedTransfer`.
//
// The legacy single-shot `transfer()` is kept as a deprecated alias for
// callers that have not migrated.

export interface UmbraCreateTransferIntentParams {
  deploymentId: string;
  /** Sender side signer (HKDF-derived per-vault keypair). */
  fromSigner: UmbraSignerOverride;
  /** Recipient public key in base58. */
  toRecipientPubkey: string;
  mint: string;
  amount: string;
}

export interface UmbraCreateTransferIntentResult {
  /**
   * Reference to the published claimable UTXO. The shape is opaque to the
   * platform (the SDK owns the schema); the platform only stores it so the
   * recipient can later present it to `claimEncryptedTransfer`.
   */
  claimableUtxoRef: string | null;
  queueSignature: string | null;
  callbackSignature: string | null;
  status: 'pending' | 'confirmed' | 'failed';
}

export interface UmbraClaimTransferParams {
  /**
   * Returned previously by createEncryptedTransferIntent. With SDK 4.0 this
   * is the sender's `queueSignature` — the recipient uses it as a hint to
   * scan the indexer for the matching claimable UTXO. The actual claim flow
   * walks `scanClaimableUtxos` to find the UTXO data the SDK requires.
   */
  claimableUtxoRef?: string;
  /** Recipient signer that will execute the SDK claim flow. */
  recipientSigner: UmbraSignerOverride;
  /**
   * Scan window for `getClaimableUtxoScannerFunction(treeIndex, startInsertion, endInsertion)`.
   * Defaults: `treeIndex=0`, `startInsertionIndex=0`, `endInsertionIndex=10000`.
   * Tune if the indexer holds many trees or to limit work.
   */
  scanWindow?: {
    treeIndex?: number;
    startInsertionIndex?: number;
    endInsertionIndex?: number;
  };
}

export interface UmbraClaimTransferResult {
  queueSignature: string | null;
  callbackSignature: string | null;
  status: 'pending' | 'confirmed' | 'failed';
  /** Number of UTXOs successfully claimed (post-batching). */
  claimedCount?: number;
  /** Reason the claim was unavailable (e.g. provider not configured). */
  unavailableReason?: string;
}

export interface UmbraScanClaimableParams {
  recipientSigner: UmbraSignerOverride;
  scanWindow?: {
    treeIndex?: number;
    startInsertionIndex?: number;
    endInsertionIndex?: number;
  };
}

export interface UmbraScanClaimableResult {
  /** Count of receiver-flow UTXOs found pending claim. */
  receiverCount: number;
  /** Count of self-flow (ephemeral) UTXOs found pending claim. */
  ephemeralCount: number;
  /** True when the SDK couldn't run (provider/relayer not configured). */
  unavailable: boolean;
  unavailableReason?: string;
}

export interface UmbraAdapterPort {
  registerEncryptedUserAccount(params: UmbraRegisterParams): Promise<UmbraRegisterResult>;
  deposit(params: UmbraDepositParams): Promise<UmbraTreasuryResult>;
  withdraw(params: UmbraWithdrawParams): Promise<UmbraTreasuryResult>;
  /**
   * @deprecated SDK 4.0 does not support synchronous transfer. Use
   * `createEncryptedTransferIntent` + `claimEncryptedTransfer` for new code.
   * The legacy `transfer()` always returns a failed status to surface the
   * deprecation to callers that still depend on it.
   */
  transfer(params: UmbraTransferParams): Promise<UmbraTreasuryResult>;
  createEncryptedTransferIntent(
    params: UmbraCreateTransferIntentParams,
  ): Promise<UmbraCreateTransferIntentResult>;
  claimEncryptedTransfer(params: UmbraClaimTransferParams): Promise<UmbraClaimTransferResult>;
  /**
   * Phase-5 helper: scan the Umbra indexer for receiver-flow UTXOs that are
   * pending claim by `recipientSigner`. Used by admin reconciliation and by
   * the claim flow itself (which calls the scanner internally).
   */
  scanClaimableUtxos(params: UmbraScanClaimableParams): Promise<UmbraScanClaimableResult>;
  getEncryptedBalance(params: UmbraEncryptedBalanceParams): Promise<UmbraEncryptedBalance>;
  grantViewer(params: UmbraGrantViewerParams): Promise<UmbraGrantResult>;
}
