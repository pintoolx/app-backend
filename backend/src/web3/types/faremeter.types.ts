import {
    type PaymentExecer,
    type RequestContext,
    type PaymentHandler,
} from '@faremeter/types/dist/src/client';

import {
    type x402PaymentRequirements,
    type x402PaymentPayload,
    type x402PaymentRequiredResponse,
} from '@faremeter/types/dist/src/x402';

// Re-export types for convenience
export type {
    PaymentExecer,
    RequestContext,
    PaymentHandler,
    x402PaymentRequirements,
    x402PaymentPayload,
    x402PaymentRequiredResponse,
};

// Additional types specific to our implementation
export interface PaymentConfig {
    network: 'solana-devnet' | 'solana-mainnet' | 'base-sepolia';
    scheme: 'exact' | 'prepayable';
    recipientWallet: string;
    recipientTokenAccount?: string; // For Solana token payments
    tokenMint: string;
    amount: number;
    asset?: string;
}

export interface PaymentValidationResult {
    valid: boolean;
    error?: string;
    details?: {
        recipient: string;
        amount: number;
        mint?: string;
        signature?: string;
    };
}

export interface PaymentProcessResult {
    signature: string;
    amount: number;
    amountReadable: number;
    recipient: string;
    explorerUrl: string;
    network: string;
    confirmed: boolean;
}

// Controller response types
export interface X402SuccessResponse {
    data: any;
    paymentDetails?: any;
}

export interface X402ErrorResponse {
    error: string;
    code: string;
}
