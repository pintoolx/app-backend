# strategy_runtime — Anchor program

Phase 1 on-chain registry for the strategy platform. Tracks `StrategyVersion`,
`StrategyDeployment`, `VaultAuthority`, `StrategyState` and `PublicSnapshot`
PDAs and enforces lifecycle / replay invariants.

## Toolchain

- Solana CLI 3.1.x (`agave-install update`)
- Anchor 0.31.x (`avm use 0.31.0`)
- Rust + cargo via rustup
- Node 18+ with yarn or npm

## Build & test (localnet)

```bash
cd programs
yarn install                  # one-time, installs ts-mocha + chai
anchor build                  # produces target/deploy/*.so + target/idl/strategy_runtime.json
anchor test                   # spins up solana-test-validator and runs tests/*.spec.ts
```

The `anchor test` suite covers happy path, replay protection on `commit_state`,
monotonic snapshot revisions, illegal lifecycle transitions, and `close_deployment`
preconditions.

## Devnet deployment (hackathon)

```bash
solana airdrop 5 --url devnet
anchor build
anchor keys sync              # syncs declare_id! and Anchor.toml to the keypair address
anchor build                  # rebuild after key sync
anchor deploy --provider.cluster devnet

# Sync IDL + types into the backend
cp target/idl/strategy_runtime.json ../backend/src/onchain/anchor/
cp target/types/strategy_runtime.ts  ../backend/src/onchain/anchor/

# Configure the backend to use the Anchor adapter
PROGRAM_ID=$(solana address -k target/deploy/strategy_runtime-keypair.json)
echo "STRATEGY_RUNTIME_PROGRAM_ID=$PROGRAM_ID"        >> ../backend/.env
echo "STRATEGY_RUNTIME_KEEPER_SECRET=$(cat ~/.config/solana/id.json)" >> ../backend/.env
```

When `STRATEGY_RUNTIME_PROGRAM_ID` is set the backend automatically swaps the
`ONCHAIN_ADAPTER` provider from `NoopOnchainAdapter` to
`AnchorOnchainAdapterService`; unset it (or leave the value blank) to fall back
to the no-op adapter for local development and CI.

## Layout

```
programs/
├── Anchor.toml
├── Cargo.toml                                  # workspace
├── package.json                                # ts-mocha + @coral-xyz/anchor for tests
├── tsconfig.json
├── programs/strategy_runtime/                  # Rust program
│   ├── Cargo.toml
│   └── src/
│       ├── lib.rs                              # entry, declares ix routes
│       ├── constants.rs                        # PDA seed prefixes
│       ├── errors.rs
│       ├── state/                              # 5 account structs (with reserved bytes)
│       └── instructions/                       # 8 ix handlers
└── tests/strategy_runtime.spec.ts              # ts-mocha integration tests
```
