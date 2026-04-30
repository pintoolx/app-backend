import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Connection, Transaction } from '@solana/web3.js';
import { StrategySubscriptionsRepository } from './subscriptions.repository';

/**
 * Phase 2.1 — Fund Intent Submission Service
 *
 * Receives a signed base64-encoded transaction from a follower and submits
 * it to the Solana network.  After confirmation it updates the follower
 * vault record so the subscription provisioning flow can continue.
 */
@Injectable()
export class FundIntentSubmissionService {
  private readonly logger = new Logger(FundIntentSubmissionService.name);

  constructor(
    private readonly subscriptionsRepository: StrategySubscriptionsRepository,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Submit a signed fund-intent transaction on-chain.
   *
   * @param deploymentId   Deployment UUID (for logging)
   * @param subscriptionId Subscription UUID
   * @param walletAddress  Follower wallet (must match subscription owner)
   * @param signedTxBase64 Base64-encoded signed Solana transaction
   * @returns Object containing the on-chain signature and confirmation status
   */
  async submitFundIntent(
    deploymentId: string,
    subscriptionId: string,
    walletAddress: string,
    signedTxBase64: string,
  ): Promise<{
    signature: string;
    confirmed: boolean;
    vaultAuthorityPda: string;
  }> {
    // 1. Verify subscription ownership
    const sub = await this.subscriptionsRepository.getById(subscriptionId);
    if (!sub) {
      throw new BadRequestException('Subscription not found');
    }
    if (sub.deployment_id !== deploymentId) {
      throw new BadRequestException('Subscription does not belong to this deployment');
    }
    if (sub.follower_wallet !== walletAddress) {
      throw new BadRequestException('Wallet does not own this subscription');
    }
    if (!sub.vault_authority_pda) {
      throw new BadRequestException(
        'Subscription has no vault_authority PDA — provisioning incomplete',
      );
    }

    // 2. Deserialize and lightweight validation
    let tx: Transaction;
    try {
      const buffer = Buffer.from(signedTxBase64, 'base64');
      tx = Transaction.from(buffer);
    } catch (err) {
      throw new BadRequestException(
        `Invalid transaction format: ${err instanceof Error ? err.message : err}`,
      );
    }

    // Basic sanity check: the transaction should have at least one instruction
    if (tx.instructions.length === 0) {
      throw new BadRequestException('Transaction contains no instructions');
    }

    // 3. Submit to Solana
    const rpcUrl =
      this.configService.get<string>('SOLANA_RPC_URL') ??
      'https://api.devnet.solana.com';
    const connection = new Connection(rpcUrl, 'confirmed');

    const signature = await connection.sendRawTransaction(tx.serialize(), {
      skipPreflight: true,
    });

    this.logger.log(
      `Fund intent submitted: sig=${signature} sub=${subscriptionId} vault=${sub.vault_authority_pda}`,
    );

    // 4. Wait for confirmation (best-effort; 30s timeout)
    let confirmed = false;
    try {
      const status = await connection.confirmTransaction(signature, 'confirmed');
      confirmed = !status.value.err;
      if (!confirmed) {
        this.logger.warn(
          `Fund intent transaction failed on-chain: sig=${signature} err=${JSON.stringify(status.value.err)}`,
        );
      }
    } catch (confirmErr) {
      this.logger.warn(
        `Fund intent confirmation timeout: sig=${signature} sub=${subscriptionId}`,
      );
    }

    return {
      signature,
      confirmed,
      vaultAuthorityPda: sub.vault_authority_pda,
    };
  }
}
