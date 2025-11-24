import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { Connection, Transaction, PublicKey } from '@solana/web3.js';
import { createPaymentHandler } from '@faremeter/payment-solana/dist/src/exact';
import {
    type x402PaymentPayload,
    type PaymentConfig,
    type PaymentValidationResult,
    type PaymentProcessResult,
    type PaymentHandler,
} from '../types/faremeter.types';
import { ConnectionService } from './connection.service';

/**
 * Payment Solana Service
 *
 * Solana-specific payment handler implementing the exact and prepayable schemes.
 * This service handles Solana transaction validation, submission, and confirmation.
 */
@Injectable()
export class PaymentSolanaService {
    private readonly logger = new Logger(PaymentSolanaService.name);

    constructor(private readonly connectionService: ConnectionService) { }

    /**
     * Get Solana connection for the specified network
     */
    private getConnection(network: string): Connection {
        const pool = this.connectionService.getConnectionPool();

        // For now, use the configured connection
        // In the future, we might want to support multiple networks
        if (network === 'solana-mainnet' || network === 'solana-devnet') {
            return pool.legacyConnection;
        }

        throw new Error(`Unsupported network: ${network}`);
    }

    /**
     * Validate Solana transaction against payment requirements
     */
    async validateTransaction(
        paymentPayload: x402PaymentPayload,
        requirements: PaymentConfig,
    ): Promise<PaymentValidationResult> {
        try {
            const connection = this.getConnection(requirements.network);

            // Extract serialized transaction from payload
            if (!paymentPayload.payload || typeof paymentPayload.payload !== 'object') {
                return {
                    valid: false,
                    error: 'Invalid payment payload: missing transaction data',
                };
            }

            const payload = paymentPayload.payload as any;
            if (!payload.serializedTransaction) {
                return {
                    valid: false,
                    error: 'Invalid payment payload: missing serializedTransaction',
                };
            }

            // Deserialize transaction
            const txBuffer = Buffer.from(payload.serializedTransaction, 'base64');
            const transaction = Transaction.from(txBuffer);

            this.logger.log('Validating Solana transaction...');
            this.logger.log(`  Instructions: ${transaction.instructions.length}`);

            // Find SPL Token transfer instruction
            const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
            let foundValidTransfer = false;
            let transferDetails: { recipient: string; amount: number; mint: string } | null = null;

            for (const instruction of transaction.instructions) {
                // Check if this is a token transfer instruction
                if (instruction.programId.toBase58() === TOKEN_PROGRAM_ID) {
                    const data = instruction.data;

                    // Transfer instruction: first byte is 3 for Transfer, then 8 bytes for amount
                    if (data[0] === 3 && data.length >= 9) {
                        const amount = Number(data.readBigUInt64LE(1));

                        // Get accounts: [source, destination, owner]
                        const destination = instruction.keys[1]?.pubkey.toBase58();

                        // Validate destination and amount
                        const expectedDestination = requirements.recipientTokenAccount;
                        const expectedAmount = Math.floor(requirements.amount * 1_000_000); // Convert to smallest units

                        if (destination === expectedDestination && amount === expectedAmount) {
                            foundValidTransfer = true;
                            transferDetails = {
                                recipient: destination,
                                amount,
                                mint: requirements.tokenMint,
                            };
                            break;
                        }
                    }
                }
            }

            if (!foundValidTransfer) {
                return {
                    valid: false,
                    error: 'Transaction does not contain valid transfer to recipient with correct amount',
                };
            }

            // Simulate transaction to check for errors
            this.logger.log('Simulating transaction...');
            try {
                const simulation = await connection.simulateTransaction(transaction);

                if (simulation.value.err) {
                    return {
                        valid: false,
                        error: `Transaction simulation failed: ${JSON.stringify(simulation.value.err)}`,
                    };
                }

                this.logger.log('  ✓ Simulation successful');
            } catch (error) {
                return {
                    valid: false,
                    error: `Transaction simulation error: ${error instanceof Error ? error.message : 'Unknown'}`,
                };
            }

            return {
                valid: true,
                details: transferDetails!,
            };
        } catch (error) {
            return {
                valid: false,
                error: `Transaction validation error: ${error instanceof Error ? error.message : 'Unknown'}`,
            };
        }
    }

    /**
     * Submit transaction to Solana blockchain and wait for confirmation
     */
    async submitAndConfirm(
        paymentPayload: x402PaymentPayload,
        network: string,
    ): Promise<PaymentProcessResult> {
        try {
            const connection = this.getConnection(network);

            // Extract serialized transaction from payload
            const payload = paymentPayload.payload as any;
            const txBuffer = Buffer.from(payload.serializedTransaction, 'base64');
            const transaction = Transaction.from(txBuffer);

            this.logger.log('Submitting transaction to blockchain...');

            // Send transaction
            const signature = await connection.sendRawTransaction(txBuffer, {
                skipPreflight: false,
                preflightCommitment: 'confirmed',
            });

            this.logger.log(`  Transaction submitted: ${signature}`);

            // Wait for confirmation
            const confirmation = await connection.confirmTransaction(signature, 'confirmed');

            if (confirmation.value.err) {
                throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
            }

            this.logger.log('  ✓ Transaction confirmed');

            // Extract payment details from transaction
            const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
            const transferInstruction = transaction.instructions.find(
                (ix) => ix.programId.toBase58() === TOKEN_PROGRAM_ID && ix.data[0] === 3,
            );

            const amount = transferInstruction ? Number(transferInstruction.data.readBigUInt64LE(1)) : 0;
            const recipient = transferInstruction?.keys[1]?.pubkey.toBase58() || '';

            // Generate explorer URL
            const explorerBase = 'https://explorer.solana.com/tx';
            const cluster = network === 'solana-devnet' ? '?cluster=devnet' : '';
            const explorerUrl = `${explorerBase}/${signature}${cluster}`;

            return {
                signature,
                amount,
                amountReadable: amount / 1_000_000, // Convert to readable USDC
                recipient,
                explorerUrl,
                network,
                confirmed: true,
            };
        } catch (error) {
            throw new BadRequestException(
                `Failed to submit transaction: ${error instanceof Error ? error.message : 'Unknown'}`,
            );
        }
    }

    /**
     * Process complete Solana payment flow
     *
     * Validates the payment and submits it to the blockchain
     */
    async processPayment(
        paymentPayload: x402PaymentPayload,
        requirements: PaymentConfig,
    ): Promise<PaymentProcessResult> {
        this.logger.log('Processing Solana payment...');
        this.logger.log(`  Network: ${requirements.network}`);
        this.logger.log(`  Scheme: ${requirements.scheme}`);

        // Validate transaction
        const validation = await this.validateTransaction(paymentPayload, requirements);

        if (!validation.valid) {
            throw new BadRequestException(`Payment validation failed: ${validation.error}`);
        }

        this.logger.log('  ✓ Payment validation passed');

        // Submit transaction
        const result = await this.submitAndConfirm(paymentPayload, requirements.network);

        return result;
    }
}
