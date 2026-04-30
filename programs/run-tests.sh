#!/usr/bin/env bash
set -euo pipefail

# Test runner for strategy_runtime
# Usage: ./run-tests.sh [tier]
#   tier = rust    → Rust unit tests only (fastest)
#   tier = unit    → TS unit tests with anchor test
#   tier = devnet  → Devnet smoke tests (requires funded wallet)
#   tier = all     → Run everything locally (excluding devnet)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

TIER="${1:-all}"

case "$TIER" in
  rust)
    echo "=== Running Rust unit tests ==="
    cd programs/strategy_runtime && cargo test
    ;;

  unit)
    echo "=== Running TS unit tests (anchor test) ==="
    NO_DNA=1 anchor test --skip-build
    ;;

  devnet)
    echo "=== Running Devnet smoke tests ==="
    export ANCHOR_PROVIDER_URL=https://api.devnet.solana.com
    export ANCHOR_WALLET=tests/devnet/test-wallet.json
    yarn ts-mocha -p ./tsconfig.json -t 300000 tests/devnet/smoke.spec.ts
    ;;

  all)
    echo "=== Running Rust unit tests ==="
    (cd programs/strategy_runtime && cargo test)
    echo ""
    echo "=== Running TS unit tests ==="
    NO_DNA=1 anchor test --skip-build
    ;;

  *)
    echo "Unknown tier: $TIER"
    echo "Usage: $0 [rust|unit|devnet|all]"
    exit 1
    ;;
esac

echo ""
echo "✅ Tests completed successfully"
