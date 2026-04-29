/**
 * Phase-5 helper port: pluggable Groth16 zkProver suite + Umbra relayer.
 *
 * `@umbra-privacy/sdk@4.0.0` exposes the claimable-UTXO transfer/claim
 * factory functions but does NOT ship default zkProver implementations
 * (each circuit needs its own Groth16 zkey + WASM artifact, which the SDK
 * intentionally leaves to the caller). It also expects a relayer instance
 * built around an HTTP endpoint controlled by the deployment.
 *
 * To keep the platform code testable AND deployable in stages, we keep
 * those concerns behind a Nest port so:
 *
 * 1. dev / test environments inject a `NoopUmbraZkProverProvider` that
 *    cleanly fails the (still off-by-default) transfer flows; existing
 *    deposit / withdraw / register paths are unaffected.
 * 2. production deployments register an implementation that loads circuit
 *    artifacts and points at the Umbra-hosted relayer URL.
 *
 * The shape mirrors `IZkProverSuite` from the SDK but only surfaces the
 * provers that the platform actually needs (receiver-side transfer +
 * claim into encrypted balance). Add more entries here as we wire
 * additional flows.
 */
export const UMBRA_ZK_PROVER_PROVIDER = Symbol('UmbraZkProverProvider');

/**
 * Subset of the SDK `IZkProverSuite` that the platform exercises today.
 * `unknown` is used so the port stays decoupled from the SDK's branded
 * types — the real adapter casts to the SDK type at the call site.
 */
export interface UmbraZkProverSuite {
  /** Receiver-claimable UTXO creator (sender side of a transfer). */
  readonly utxoReceiverClaimable: unknown;
  /** Receiver claimer (recipient side of a transfer). */
  readonly claimReceiverClaimableIntoEncryptedBalance: unknown;
}

/**
 * Lightweight port: wraps `getUmbraRelayer({ apiEndpoint })` so the relayer
 * URL can be configured per deployment without leaking SDK types upward.
 *
 * Returns `null` when the deployment has not configured a relayer yet —
 * in that mode the transfer surface remains unavailable but the rest of
 * the Umbra adapter keeps working.
 */
export interface UmbraZkProverProviderPort {
  getZkProverSuite(): Promise<UmbraZkProverSuite | null>;
  /** SDK relayer instance (an `IUmbraRelayer`). `null` when unconfigured. */
  getRelayer(): Promise<unknown | null>;
}
