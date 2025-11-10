import {
  Controller,
  Get,
  Post,
  Body,
  Headers,
  HttpStatus,
  HttpException,
  Logger,
} from '@nestjs/common';
import { X402Service } from './x402.service';
import {
  X402SuccessResponse,
  X402ErrorResponse,
} from '../../../src-legacy/types/x402-types';

/**
 * X402 Payment Controller
 *
 * Provides example endpoints demonstrating x402 payment protocol.
 * These endpoints require payment before serving content.
 */
@Controller('x402')
export class X402Controller {
  private readonly logger = new Logger(X402Controller.name);

  // Configuration for demo endpoints
  private readonly config = {
    network: 'devnet' as const,
    recipientWallet: 'seFkxFkXEY9JGEpCyPfCWTuPZG9WK6ucf95zvKCfsRX', // Example wallet
    recipientTokenAccount: 'HyBjJjQe6q7Y8U2xkz7qCJB1s7YHrz4rUHFZnD5p8wqx', // Example token account
    tokenMint: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU', // Devnet USDC
    premiumAmount: 0.0001, // 0.0001 USDC
    queryAmount: 0.00005, // 0.00005 USDC
  };

  constructor(private readonly x402Service: X402Service) {}

  /**
   * GET /api/x402/premium
   *
   * Example endpoint that requires payment to access premium content.
   * Returns 402 on first request, validates payment and returns content on retry with X-Payment.
   */
  @Get('premium')
  async getPremiumContent(
    @Headers('x-payment') xPayment?: string,
  ): Promise<X402SuccessResponse | X402ErrorResponse> {
    this.logger.log('Premium content request received');

    // If no payment header, return 402 with payment requirements
    if (!xPayment) {
      this.logger.log('  No payment header, returning 402');

      const paymentRequirements = this.x402Service.generatePaymentRequirements({
        recipientWallet: this.config.recipientWallet,
        recipientTokenAccount: this.config.recipientTokenAccount,
        tokenMint: this.config.tokenMint,
        amountUSDC: this.config.premiumAmount,
        network: this.config.network,
      });

      throw new HttpException(paymentRequirements, HttpStatus.PAYMENT_REQUIRED);
    }

    // Payment header present, validate and process payment
    try {
      this.logger.log('  Payment header present, processing...');

      const paymentDetails = await this.x402Service.processPayment(xPayment, {
        recipientTokenAccount: this.config.recipientTokenAccount,
        amount: Math.floor(this.config.premiumAmount * 1_000_000),
        mint: this.config.tokenMint,
        network: this.config.network,
      });

      this.logger.log('  ✓ Payment successful, returning premium content');

      // Return premium content with payment details
      return {
        data: {
          message: 'Welcome to premium content!',
          content: {
            title: 'Premium Feature Access',
            description:
              'This is exclusive premium content that requires payment to access.',
            benefits: [
              'Access to advanced features',
              'Priority support',
              'Exclusive data and insights',
              'Early access to new features',
            ],
            timestamp: new Date().toISOString(),
          },
        },
        paymentDetails,
      };
    } catch (error) {
      this.logger.error(`  ❌ Payment error: ${error instanceof Error ? error.message : 'Unknown'}`);

      return {
        error: error instanceof Error ? error.message : 'Payment processing failed',
        code: 'PAYMENT_ERROR',
      };
    }
  }

  /**
   * POST /api/x402/query
   *
   * Example AI query endpoint that requires micro-payment per query.
   * Returns 402 on first request, processes query after payment.
   */
  @Post('query')
  async processQuery(
    @Body() body: { query: string },
    @Headers('x-payment') xPayment?: string,
  ): Promise<X402SuccessResponse | X402ErrorResponse> {
    this.logger.log('AI query request received');

    if (!body.query) {
      return {
        error: 'Query is required',
        code: 'INVALID_REQUEST',
      };
    }

    // If no payment header, return 402 with payment requirements
    if (!xPayment) {
      this.logger.log('  No payment header, returning 402');

      const paymentRequirements = this.x402Service.generatePaymentRequirements({
        recipientWallet: this.config.recipientWallet,
        recipientTokenAccount: this.config.recipientTokenAccount,
        tokenMint: this.config.tokenMint,
        amountUSDC: this.config.queryAmount,
        network: this.config.network,
      });

      throw new HttpException(paymentRequirements, HttpStatus.PAYMENT_REQUIRED);
    }

    // Payment header present, validate and process payment
    try {
      this.logger.log('  Payment header present, processing...');

      const paymentDetails = await this.x402Service.processPayment(xPayment, {
        recipientTokenAccount: this.config.recipientTokenAccount,
        amount: Math.floor(this.config.queryAmount * 1_000_000),
        mint: this.config.tokenMint,
        network: this.config.network,
      });

      this.logger.log('  ✓ Payment successful, processing query');

      // Simulate AI query processing
      const response = this.simulateAIQuery(body.query);

      return {
        data: {
          query: body.query,
          response,
          timestamp: new Date().toISOString(),
          tokensUsed: 150,
        },
        paymentDetails,
      };
    } catch (error) {
      this.logger.error(`  ❌ Payment error: ${error instanceof Error ? error.message : 'Unknown'}`);

      return {
        error: error instanceof Error ? error.message : 'Payment processing failed',
        code: 'PAYMENT_ERROR',
      };
    }
  }

  /**
   * GET /api/x402/info
   *
   * Public endpoint that returns information about available paid endpoints.
   */
  @Get('info')
  getInfo() {
    return {
      service: 'X402 Payment Protocol Demo',
      version: '1.0.0',
      endpoints: [
        {
          path: '/api/x402/premium',
          method: 'GET',
          description: 'Access premium content',
          price: `${this.config.premiumAmount} USDC`,
          network: this.config.network,
        },
        {
          path: '/api/x402/query',
          method: 'POST',
          description: 'Process AI query',
          price: `${this.config.queryAmount} USDC`,
          network: this.config.network,
          body: { query: 'string' },
        },
      ],
      paymentInfo: {
        network: this.config.network,
        tokenMint: this.config.tokenMint,
        recipientWallet: this.config.recipientWallet,
        recipientTokenAccount: this.config.recipientTokenAccount,
      },
      howToUse: [
        '1. Make initial request to endpoint',
        '2. Receive 402 status with payment requirements',
        '3. Create and sign Solana transaction',
        '4. Retry request with X-Payment header containing signed transaction',
        '5. Server validates, submits transaction, and returns content',
      ],
    };
  }

  /**
   * Simulate AI query processing (placeholder)
   */
  private simulateAIQuery(query: string): string {
    // This is a simple simulation - in production, you'd integrate with real AI
    const responses: Record<string, string> = {
      default: `I received your query: "${query}". This is a demo response showing how micro-payments can enable pay-per-query AI services.`,
      hello: 'Hello! I\'m an AI assistant powered by x402 payments. Each query costs a small amount of USDC.',
      price: `Current prices: Premium content costs ${this.config.premiumAmount} USDC, queries cost ${this.config.queryAmount} USDC.`,
      help: 'I can help with various tasks. This service uses x402 protocol for micropayments, allowing you to pay only for what you use.',
    };

    const lowerQuery = query.toLowerCase();

    if (lowerQuery.includes('hello') || lowerQuery.includes('hi')) {
      return responses.hello;
    }
    if (lowerQuery.includes('price') || lowerQuery.includes('cost')) {
      return responses.price;
    }
    if (lowerQuery.includes('help')) {
      return responses.help;
    }

    return responses.default;
  }
}
