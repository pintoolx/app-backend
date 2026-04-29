# Umbra Transfer Spike — Claimable UTXO Model

Status: **resolved**. Phase 5 has wired both `createEncryptedTransferIntent`
and `claimEncryptedTransfer` against the real SDK functions, behind a
`UMBRA_TRANSFER_ENABLED` feature flag plus a pluggable
`UmbraZkProverProviderPort` (zkProver suite + relayer). What's left is the
production concern of loading actual Groth16 circuits and pointing at the
Umbra-hosted relayer URL — explicitly listed below as deployment
prerequisites, not engineering work.

This doc tracks what we learned about the
`@umbra-privacy/sdk@4.0.0` confidential-transfer surface during the spike
so the next person picking it up can validate the wiring quickly.

## Why this exists

The platform's `UmbraAdapterPort.transfer()` was modelled as a single,
synchronous result. That contract does not match SDK 4.0, which exposes
*claimable UTXO* primitives instead:

- `getEncryptedBalanceToReceiverClaimableUtxoCreatorFunction` — sender publishes
  a claimable UTXO addressed to a recipient.
- `getEncryptedBalanceToSelfClaimableUtxoCreatorFunction` — self-transfer
  variant (used for redeem-to-self flows).
- A separate claim flow on the recipient side that consumes the UTXO into
  the recipient's encrypted balance.

The `transfer()` method is therefore deprecated; new code uses the
`createEncryptedTransferIntent` → `claimEncryptedTransfer` pair on
`UmbraAdapterPort`.

## Open questions — resolved

1. **Exact arg shape** of
   `getEncryptedBalanceToReceiverClaimableUtxoCreatorFunction`.
   ✅ **Resolved.** Two-stage factory: `factory({ client }, { zkProver })`
   returns a callable `(input: { amount: bigint, destinationAddress:
   string, mint: string }) => Promise<CreateUtxoFromEncryptedBalanceResult>`.
   Branded `Address`/`U64` types are accepted as plain strings/bigints at
   runtime — `umbra-real.adapter.ts` casts through `unknown` so the port
   surface stays SDK-decoupled.
2. **Callback fingerprint** for the publisher.
   ✅ **Resolved.** `CreateUtxoFromEncryptedBalanceResult` always returns
   `queueSignature` (publish tx) and optionally `callbackSignature` +
   `callbackStatus: 'finalized' | 'pruned' | 'timed-out'`. We map
   `'finalized'` → `confirmed`, `'timed-out'` → `failed`, anything else
   → `pending`.
3. **Claim invocation**.
   ✅ **Resolved.** Use
   `getReceiverClaimableUtxoToEncryptedBalanceClaimerFunction({ client },
   { zkProver, relayer })`. The receiver discovers UTXOs via
   `getClaimableUtxoScannerFunction({ client })(treeIndex, start, end)`
   first; the resulting `result.receiver` array is fed straight into the
   claimer. Result shape: `{ batches: Map<number, ClaimBatchResult> }`
   with per-batch `requestId`, `status`, `txSignature`, `callbackSignature`.
4. **Recipient signer model**.
   ✅ **Resolved as Option A.** The platform owns the recipient signer
   (per-vault HKDF) and runs the claim on behalf of the follower. The
   claim path uses `clientService.withSigner(recipientSecret, …)` so the
   recipient signer is mounted only for the duration of the SDK call.
5. **Prover / relayer dependencies**.
   ✅ **Resolved.** `IUmbraClient` does NOT auto-attach a `zkProverSuite`
   or relayer — the SDK ships factory plumbing only. Two new prerequisites
   on production deployments:
     - **`UMBRA_RELAYER_ENDPOINT`** env var → constructed into an
       `IUmbraRelayer` via `getUmbraRelayer({ apiEndpoint })`.
     - A real `UmbraZkProverProviderPort` implementation that loads
       Groth16 zkey + WASM circuits for `ReceiverClaimableUtxo` and
       `ClaimReceiverClaimableUtxo` (4 batch-size variants, 1–4 UTXOs
       per proof). The default `NoopUmbraZkProverProvider` returns
       `null` so the surface short-circuits cleanly until the real
       provider lands.

## Surprise findings (worth flagging)

- `CreateUtxoFromEncryptedBalanceResult` has **no** `claimableUtxoRef`
  field. The recipient finds the UTXO by scanning the indexer, not by
  consuming a sender-supplied ref. We use the sender's `queueSignature`
  as the platform-side correlation key on `treasury_settlement_intents`
  rows so admin views can still tie a publish to its eventual claim.
- A single `transfer` produces **2–3 transactions** (proof-account
  create / queue / optional close-proof / callback / rent-reclaim). All
  are batched inside the SDK; the platform only sees `queueSignature` +
  optional `callbackSignature`.
- The claim flow batches up to 4 UTXOs per ZK proof. The adapter folds
  the batch result into a single `pending|confirmed|failed` status but
  also exposes `claimedCount` so callers can detect partial-batch state.

## Configuration prerequisites for production

Set these env vars on a deployment that wants real confidential transfer:

```
UMBRA_ENABLED=true               # already used by deposit / withdraw / register
UMBRA_TRANSFER_ENABLED=true      # gates createEncryptedTransferIntent / claimEncryptedTransfer
UMBRA_RELAYER_ENDPOINT=...       # e.g. https://relayer.umbra.finance
```

Then register a real `UmbraZkProverProviderPort` implementation in place
of `NoopUmbraZkProverProvider` (`backend/src/umbra/umbra.module.ts`) — it
should load the Groth16 circuit artifacts (zkey + WASM) for the two
flows we wire today and return them inside `getZkProverSuite()`.

## Settlement flow (target shape)

`treasury_settlement_intents` table tracks the asynchronous lifecycle:

```
created  →  intent-queued  →  claim-queued  →  confirmed
                       ↘                   ↘
                          failed              stuck (admin retry)
```

- `unsubscribe` with `policy = 'unshield'`: skip claim flow, call
  `withdraw` directly to push public balance to follower wallet. Single
  status transition: `created → intent-queued → confirmed`.
- `unsubscribe` with `policy = 'transfer-to-self'`: publish claimable UTXO
  to follower's per-vault signer, then run claim on behalf of the
  recipient. Two-stage transition.
- `redeem`: same shape as `unsubscribe` but lifecycle remains `closed`
  until claim confirms.

## Relationship to magicblock-private-payments

`MagicBlockPrivatePaymentsAdapterPort` is the **public** SPL transfer surface
(builds unsigned tx, wallet signs+broadcasts). It is NOT the same as Umbra's
encrypted treasury. Phase 5 keeps both: `magicblock-private-payments` for
public funding flows (`fundIntent`); Umbra claimable-UTXO for encrypted
value movement.

## Acceptance criteria — status

1. ✅ `umbra-real.adapter.ts::createEncryptedTransferIntent` calls
   `getEncryptedBalanceToReceiverClaimableUtxoCreatorFunction` and
   surfaces the SDK's `queueSignature` as `claimableUtxoRef`. Verified by
   `umbra-real.adapter.spec.ts: "publishes claimable UTXO and maps SDK
   queue signature to ref + status"`.
2. ✅ `umbra-real.adapter.ts::claimEncryptedTransfer` runs scan → claim,
   handles empty-scan idempotency, and reports per-batch status.
   Verified by the four `claimEncryptedTransfer` cases in the spec.
3. ⏳ End-to-end `redeem` happy path is now scaffolded but still requires
   the production zkProver suite + relayer. Once those land, hooking
   this into the existing operator checklist ("Step 10: unsubscribe +
   redeem") completes the loop.
4. ✅ Prover / relayer footprint documented above + reflected in
   `umbra.module.ts` (`UMBRA_ZK_PROVER_PROVIDER` token, swappable from
   `NoopUmbraZkProverProvider` to a production implementation).
