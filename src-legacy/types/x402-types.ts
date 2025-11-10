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

/**
 * Network types supported by x402
 */
export type X402Network = 'solana-devnet' | 'solana-mainnet';

/**
 * Payment scheme types
 * - exact: Exact transaction match required
 * - any: Any payment to the specified account
 */
export type X402Scheme = 'exact' | 'any';

/**
 * Payment requirements returned by server in 402 response
 */
export interface X402PaymentRequirements {
  payment: {
    /** Recipient's token account address (ATA) */
    tokenAccount: string;
    /** Token mint address (e.g., USDC mint) */
    mint: string;
    /** Amount in smallest units (e.g., 100 for 0.0001 USDC) */
    amount: number;
    /** Human-readable amount (e.g., 0.0001) */
    amountUSDC: number;
    /** Network cluster */
    cluster: 'devnet' | 'mainnet';
    /** Optional: Recipient wallet address */
    recipientWallet?: string;
  };
}

/**
 * Payment proof sent in X-Payment header
 */
export interface X402PaymentProof {
  /** Protocol version */
  x402Version: number;
  /** Payment scheme */
  scheme: X402Scheme;
  /** Network identifier */
  network: X402Network;
  /** Payment payload */
  payload: {
    /** Base64-encoded serialized Solana transaction */
    serializedTransaction: string;
  };
}

/**
 * Payment details returned after successful payment
 */
export interface X402PaymentDetails {
  /** Transaction signature/hash */
  signature: string;
  /** Amount paid in smallest units */
  amount: number;
  /** Amount in human-readable format */
  amountUSDC: number;
  /** Recipient address */
  recipient: string;
  /** Blockchain explorer URL */
  explorerUrl: string;
  /** Network where payment was made */
  network: X402Network;
  /** Confirmation status */
  confirmed: boolean;
}

/**
 * Successful response after payment
 */
export interface X402SuccessResponse<T = any> {
  /** Response data */
  data: T;
  /** Payment details */
  paymentDetails: X402PaymentDetails;
}

/**
 * Error response
 */
export interface X402ErrorResponse {
  /** Error message */
  error: string;
  /** Error code */
  code?: string;
  /** Additional details */
  details?: any;
}

/**
 * Response from x402 endpoint (union type)
 */
export type X402Response<T = any> = X402SuccessResponse<T> | X402ErrorResponse;

/**
 * Configuration for x402 client
 */
export interface X402ClientConfig {
  /** Target URL to request */
  targetUrl: string;
  /** Solana network */
  network: 'devnet' | 'mainnet';
  /** Path to keypair JSON file */
  keypairPath: string;
  /** Maximum payment amount willing to pay (in USDC) */
  maxPaymentAmount: number;
  /** Token mint address (defaults to USDC) */
  tokenMint?: string;
  /** RPC endpoint (optional, defaults to public endpoints) */
  rpcEndpoint?: string;
  /** Timeout in milliseconds */
  timeout?: number;
}

/**
 * Configuration for x402 server
 */
export interface X402ServerConfig {
  /** Recipient wallet public key */
  recipientWallet: string;
  /** Token mint to accept (e.g., USDC) */
  tokenMint: string;
  /** Solana network */
  network: 'devnet' | 'mainnet';
  /** RPC endpoint */
  rpcEndpoint: string;
  /** Payment amount in USDC */
  amountUSDC: number;
}

/**
 * Result of transaction validation
 */
export interface X402ValidationResult {
  /** Whether validation passed */
  valid: boolean;
  /** Error message if invalid */
  error?: string;
  /** Transaction details if valid */
  details?: {
    recipient: string;
    amount: number;
    mint: string;
  };
}
