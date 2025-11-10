import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { Connection, Transaction, PublicKey } from '@solana/web3.js';
import {
  X402PaymentRequirements,
  X402PaymentProof,
  X402PaymentDetails,
  X402ValidationResult,
  X402Network,
} from '../../../src-legacy/types/x402-types';

/**
 * X402 Payment Service
 *
 * Handles server-side x402 payment protocol operations:
 * - Generate payment requirements (402 responses)
 * - Validate payment proofs from X-Payment headers
 * - Submit transactions to blockchain
 * - Verify payment completion
 */
@Injectable()
export class X402Service {
  private readonly logger = new Logger(X402Service.name);

  /**
   * Generate payment requirements for 402 response
   */
  generatePaymentRequirements(config: {
    recipientWallet: string;
    recipientTokenAccount: string;
    tokenMint: string;
    amountUSDC: number;
    network: 'devnet' | 'mainnet';
  }): X402PaymentRequirements {
    // Convert USDC amount to smallest units (6 decimals for USDC)
    const amount = Math.floor(config.amountUSDC * 1_000_000);

    return {
      payment: {
        tokenAccount: config.recipientTokenAccount,
        mint: config.tokenMint,
        amount,
        amountUSDC: config.amountUSDC,
        cluster: config.network,
        recipientWallet: config.recipientWallet,
      },
    };
  }

  /**
   * Parse X-Payment header
   */
  parsePaymentHeader(xPaymentHeader: string): X402PaymentProof {
    try {
      // Decode base64
      const decoded = Buffer.from(xPaymentHeader, 'base64').toString('utf-8');
      const paymentProof = JSON.parse(decoded) as X402PaymentProof;

      // Validate structure
      if (!paymentProof.x402Version || !paymentProof.payload?.serializedTransaction) {
        throw new Error('Invalid payment proof structure');
      }

      return paymentProof;
    } catch (error) {
      throw new BadRequestException(
        `Invalid X-Payment header: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * Validate transaction against payment requirements
   */
  async validateTransaction(
    connection: Connection,
    paymentProof: X402PaymentProof,
    requirements: {
      recipientTokenAccount: string;
      amount: number;
      mint: string;
    },
  ): Promise<X402ValidationResult> {
    try {
      // Deserialize transaction
      const txBuffer = Buffer.from(paymentProof.payload.serializedTransaction, 'base64');
      const transaction = Transaction.from(txBuffer);

      this.logger.log('Validating transaction...');
      this.logger.log(`  Instructions: ${transaction.instructions.length}`);

      // Find transfer instruction
      // SPL Token transfer instruction has specific structure
      let foundValidTransfer = false;
      let transferDetails: { recipient: string; amount: number; mint: string } | null = null;

      for (const instruction of transaction.instructions) {
        // Check if this is a token transfer instruction
        // SPL Token Program ID: TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA
        const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';

        if (instruction.programId.toBase58() === TOKEN_PROGRAM_ID) {
          // Parse instruction data
          const data = instruction.data;

          // Transfer instruction: first byte is 3 for Transfer, then 8 bytes for amount
          if (data[0] === 3 && data.length >= 9) {
            const amount = Number(
              data.readBigUInt64LE(1), // Amount is at bytes 1-8
            );

            // Get accounts: [source, destination, owner]
            const destination = instruction.keys[1]?.pubkey.toBase58();

            if (destination === requirements.recipientTokenAccount && amount === requirements.amount) {
              foundValidTransfer = true;
              transferDetails = {
                recipient: destination,
                amount,
                mint: requirements.mint,
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
          error: `Transaction simulation error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        };
      }

      return {
        valid: true,
        details: transferDetails!,
      };
    } catch (error) {
      return {
        valid: false,
        error: `Transaction validation error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  /**
   * Submit transaction to blockchain and wait for confirmation
   */
  async submitTransaction(
    connection: Connection,
    paymentProof: X402PaymentProof,
    network: X402Network,
  ): Promise<X402PaymentDetails> {
    try {
      // Deserialize transaction
      const txBuffer = Buffer.from(paymentProof.payload.serializedTransaction, 'base64');
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

      // Extract payment details
      const transferInstruction = transaction.instructions.find((ix) => {
        const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
        return ix.programId.toBase58() === TOKEN_PROGRAM_ID && ix.data[0] === 3;
      });

      const amount = transferInstruction
        ? Number(transferInstruction.data.readBigUInt64LE(1))
        : 0;
      const recipient = transferInstruction?.keys[1]?.pubkey.toBase58() || '';

      // Generate explorer URL
      const explorerBase =
        network === 'solana-devnet'
          ? 'https://explorer.solana.com/tx'
          : 'https://explorer.solana.com/tx';
      const cluster = network === 'solana-devnet' ? '?cluster=devnet' : '';
      const explorerUrl = `${explorerBase}/${signature}${cluster}`;

      return {
        signature,
        amount,
        amountUSDC: amount / 1_000_000,
        recipient,
        explorerUrl,
        network,
        confirmed: true,
      };
    } catch (error) {
      throw new BadRequestException(
        `Failed to submit transaction: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * Get Solana connection for network
   */
  getConnection(network: 'devnet' | 'mainnet', customRpc?: string): Connection {
    const rpcEndpoint =
      customRpc ||
      (network === 'devnet'
        ? 'https://api.devnet.solana.com'
        : 'https://api.mainnet-beta.solana.com');

    return new Connection(rpcEndpoint, 'confirmed');
  }

  /**
   * Process complete x402 payment flow
   */
  async processPayment(
    xPaymentHeader: string,
    requirements: {
      recipientTokenAccount: string;
      amount: number;
      mint: string;
      network: 'devnet' | 'mainnet';
    },
  ): Promise<X402PaymentDetails> {
    // Parse payment proof
    const paymentProof = this.parsePaymentHeader(xPaymentHeader);

    this.logger.log('Processing x402 payment...');
    this.logger.log(`  Network: ${paymentProof.network}`);
    this.logger.log(`  Scheme: ${paymentProof.scheme}`);

    // Get connection
    const connection = this.getConnection(requirements.network);

    // Validate transaction
    const validation = await this.validateTransaction(connection, paymentProof, requirements);

    if (!validation.valid) {
      throw new BadRequestException(`Payment validation failed: ${validation.error}`);
    }

    this.logger.log('  ✓ Payment validation passed');

    // Submit transaction
    const paymentDetails = await this.submitTransaction(connection, paymentProof, paymentProof.network);

    return paymentDetails;
  }
}
