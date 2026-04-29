# Umbra Transfer Spike — Claimable UTXO Model

Status: **spike / research**. Tracks what we know about the
`@umbra-privacy/sdk@4.0.0` confidential-transfer surface so Phase 5 can wire
`createEncryptedTransferIntent` + `claimEncryptedTransfer` against real
SDK functions.

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

## Open questions for the spike

1. **Exact arg shape** of
   `getEncryptedBalanceToReceiverClaimableUtxoCreatorFunction`. SDK
   typings use branded `Address`/`U64` types — confirm the runtime call
   signature with a hardware wallet test vector before wiring into the
   real adapter.
2. **Callback fingerprint**: `queueSignature` vs `callbackSignature`
   semantics for the SDK in claim flow. The deposit/withdraw helpers
   resolve only on queue; confirm whether the claimable-UTXO publisher
   resolves on queue, on callback, or never (relayer-driven).
3. **Claim invocation**: the SDK exports several "claim" creator
   functions. Identify the one that consumes a claimable UTXO addressed
   to the platform-held signer (relayer model) vs the recipient signer.
4. **Recipient signer model**:
    - Option A: backend owns the recipient signer (per-vault HKDF) and
      claims on behalf of the recipient. Pros: simpler UX. Cons: signer
      lives in keeper memory.
    - Option B: backend hands the claimable-UTXO ref to the wallet client
      and the user wallet runs the claim. Pros: minimal trust surface.
      Cons: wallet must hold the per-vault Ed25519 secret, which is
      not how Phase 1 was designed.
    - Working assumption: **Option A** until product picks otherwise.
5. **Prover / relayer dependencies**: confirm whether claimable UTXO
   publishing requires a separate prover service (extra env var) or
   ships entirely client-side in SDK 4.0.

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

## Acceptance criteria for closing the spike

1. `umbra-real.adapter.ts::createEncryptedTransferIntent` calls real SDK
   creator function and returns a non-null `claimableUtxoRef`.
2. `umbra-real.adapter.ts::claimEncryptedTransfer` consumes that ref and
   returns at least a queue signature.
3. End-to-end test: `redeem` with `transfer-to-self` policy publishes,
   claims, and confirms within a single test scenario using the SDK's
   in-memory test environment.
4. Document the prover/relayer footprint (env vars, ports) under
   `docs/privacy/`.
