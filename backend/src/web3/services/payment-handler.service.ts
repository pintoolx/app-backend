import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import {
    type x402PaymentRequirements,
    type x402PaymentPayload,
    type PaymentConfig,
    type PaymentValidationResult,
} from '../types/faremeter.types';
import { x402PaymentRequiredResponse } from '@faremeter/types/dist/src/x402';
import { isValidationError } from '@faremeter/types/dist/src';

/**
 * Payment Handler Service
 *
 * Core service implementing the payment handler logic following faremeter's pattern.
 * This service provides the foundation for generating payment requirements and
 * parsing payment proofs according to the x402 standard.
 */
@Injectable()
export class PaymentHandlerService {
    private readonly logger = new Logger(PaymentHandlerService.name);

    /**
     * Generate x402 payment requirements for a 402 response
     *
     * This creates the payment requirements that will be sent to the client
     * when they attempt to access a paid resource.
     */
    generatePaymentRequirements(config: PaymentConfig): x402PaymentRequiredResponse {
        const requirements: x402PaymentRequirements = {
            scheme: config.scheme,
            network: config.network,
            asset: config.asset || config.tokenMint,
            amount: config.amount,
            recipient: config.recipientWallet,
            // For Solana exact payments, include the token account
            ...(config.recipientTokenAccount && {
                recipientTokenAccount: config.recipientTokenAccount,
            }),
        };

        const response: x402PaymentRequiredResponse = {
            x402Version: '0.1',
            accepts: [requirements],
        };

        this.logger.log('Generated payment requirements:');
        this.logger.log(`  Scheme: ${requirements.scheme}`);
        this.logger.log(`  Network: ${requirements.network}`);
        this.logger.log(`  Amount: ${requirements.amount}`);
        this.logger.log(`  Recipient: ${requirements.recipient}`);

        return response;
    }

    /**
     * Parse X-Payment header
     *
     * Decodes and validates the payment proof from the X-Payment header
     */
    parsePaymentHeader(xPaymentHeader: string): x402PaymentPayload {
        try {
            // Decode base64
            const decoded = Buffer.from(xPaymentHeader, 'base64').toString('utf-8');
            const paymentPayload = JSON.parse(decoded) as x402PaymentPayload;

            // Validate structure using faremeter's validation
            const validationResult = this.validatePaymentPayload(paymentPayload);

            if (!validationResult.valid) {
                throw new Error(validationResult.error || 'Invalid payment payload structure');
            }

            this.logger.log('Parsed payment header:');
            this.logger.log(`  x402Version: ${paymentPayload.x402Version}`);
            this.logger.log(`  Scheme: ${paymentPayload.scheme}`);
            this.logger.log(`  Network: ${paymentPayload.network}`);

            return paymentPayload;
        } catch (error) {
            throw new BadRequestException(
                `Invalid X-Payment header: ${error instanceof Error ? error.message : 'Unknown error'}`,
            );
        }
    }

    /**
     * Validate payment payload structure
     */
    private validatePaymentPayload(payload: any): PaymentValidationResult {
        if (!payload.x402Version) {
            return {
                valid: false,
                error: 'Missing x402Version',
            };
        }

        if (!payload.scheme) {
            return {
                valid: false,
                error: 'Missing scheme',
            };
        }

        if (!payload.network) {
            return {
                valid: false,
                error: 'Missing network',
            };
        }

        if (!payload.payload) {
            return {
                valid: false,
                error: 'Missing payload',
            };
        }

        return { valid: true };
    }

    /**
     * Validate that payment requirements match the expected configuration
     */
    validateRequirements(
        paymentPayload: x402PaymentPayload,
        expectedConfig: PaymentConfig,
    ): PaymentValidationResult {
        // Check scheme matches
        if (paymentPayload.scheme !== expectedConfig.scheme) {
            return {
                valid: false,
                error: `Scheme mismatch: expected ${expectedConfig.scheme}, got ${paymentPayload.scheme}`,
            };
        }

        // Check network matches
        if (paymentPayload.network !== expectedConfig.network) {
            return {
                valid: false,
                error: `Network mismatch: expected ${expectedConfig.network}, got ${paymentPayload.network}`,
            };
        }

        // Check asset matches (if specified)
        if (
            expectedConfig.asset &&
            paymentPayload.asset &&
            paymentPayload.asset !== expectedConfig.asset
        ) {
            return {
                valid: false,
                error: `Asset mismatch: expected ${expectedConfig.asset}, got ${paymentPayload.asset}`,
            };
        }

        this.logger.log('✓ Payment requirements validation passed');
        return { valid: true };
    }
}
