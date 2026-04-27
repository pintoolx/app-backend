/**
 * X402 Payment Protocol Type Definitions
 *
 * The x402 protocol allows servers to require payment before serving content.
 * Flow:
 * 1. Client requests resource
 * 2. Server responds with 402 + payment requirements
 * 3. Client creates signed transaction and retries with X-Payment header
 * 4. Server validates and submits transaction, then serves content
 */
export {};
//# sourceMappingURL=x402-types.js.map