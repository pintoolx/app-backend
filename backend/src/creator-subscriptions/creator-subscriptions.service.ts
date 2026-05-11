import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Connection,
  ParsedInstruction,
  ParsedTransactionWithMeta,
  PublicKey,
  SystemProgram,
  Transaction,
} from '@solana/web3.js';
import { SupabaseService } from '../database/supabase.service';
import {
  CreatorSubscriptionsRepository,
  type CreatorSubscriptionPlanRow,
  type CreatorSubscriptionRow,
} from './creator-subscriptions.repository';

const BILLING_PERIOD_MS = 30 * 24 * 60 * 60 * 1000;

export interface CreatorSubscriptionPlanView {
  creatorWallet: string;
  /** Lamports — 1 SOL = 1_000_000_000. */
  monthlyPriceAmount: string;
  payoutWallet: string;
  isActive: boolean;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface CreatorSubscriptionView {
  id: string;
  creatorWallet: string;
  subscriberWallet: string;
  status: string;
  /** Lamports snapshotted from the plan at intent time. */
  planPriceAmount: string;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface CreatorSubscriptionPaymentIntent {
  subscriptionId: string;
  creatorWallet: string;
  subscriberWallet: string;
  /** Lamports the subscriber must transfer. */
  amount: string;
  payoutWallet: string;
  billingPeriodDays: 30;
  onchainPayment: {
    /** Base64-encoded unsigned `SystemProgram.transfer` transaction. */
    transactionBase64: string;
    recentBlockhash: string;
    lastValidBlockHeight: number;
    feePayer: string;
  };
}

@Injectable()
export class CreatorSubscriptionsService {
  private readonly logger = new Logger(CreatorSubscriptionsService.name);

  constructor(
    private readonly repository: CreatorSubscriptionsRepository,
    private readonly supabaseService: SupabaseService,
    private readonly configService: ConfigService,
  ) {}

  async upsertPlan(
    creatorWallet: string,
    params: {
      monthlyPriceAmount: string;
      payoutWallet?: string;
      metadata?: Record<string, unknown>;
    },
  ): Promise<CreatorSubscriptionPlanView> {
    if (params.monthlyPriceAmount === '0') {
      throw new BadRequestException('Monthly subscription price must be greater than zero');
    }
    const payoutWallet = params.payoutWallet ?? creatorWallet;

    await this.ensureUserExists(creatorWallet);
    await this.ensureUserExists(payoutWallet);

    const row = await this.repository.upsertPlan({
      creatorWallet,
      monthlyPriceAmount: params.monthlyPriceAmount,
      payoutWallet,
      metadata: params.metadata ?? {},
    });
    return this.toPlanView(row);
  }

  async getPlan(creatorWallet: string): Promise<CreatorSubscriptionPlanView> {
    return this.toPlanView(await this.repository.getPlan(creatorWallet));
  }

  async createIntent(
    creatorWallet: string,
    subscriberWallet: string,
  ): Promise<{
    subscription: CreatorSubscriptionView;
    paymentIntent: CreatorSubscriptionPaymentIntent;
  }> {
    if (creatorWallet === subscriberWallet) {
      throw new BadRequestException('Creators do not need to subscribe to themselves');
    }
    await this.ensureUserExists(subscriberWallet);
    const plan = await this.repository.getPlan(creatorWallet);

    const subscription = await this.repository.upsertPaymentRequiredSubscription({
      creatorWallet,
      subscriberWallet,
      planPriceAmount: plan.monthly_price_amount,
    });

    const paymentIntent = await this.toPaymentIntent(subscription, plan);
    return {
      subscription: this.toSubscriptionView(subscription),
      paymentIntent,
    };
  }

  async buildPaymentIntent(
    creatorWallet: string,
    subscriberWallet: string,
  ): Promise<CreatorSubscriptionPaymentIntent> {
    const [subscription, plan] = await Promise.all([
      this.repository.getSubscription(creatorWallet, subscriberWallet),
      this.repository.getPlan(creatorWallet),
    ]);
    return this.toPaymentIntent(subscription, plan);
  }

  async confirmPayment(
    creatorWallet: string,
    subscriberWallet: string,
    txSignature: string,
  ): Promise<CreatorSubscriptionView> {
    const [subscription, plan] = await Promise.all([
      this.repository.getSubscription(creatorWallet, subscriberWallet),
      this.repository.getPlan(creatorWallet),
    ]);

    if (await this.repository.txSignatureExists(txSignature)) {
      throw new BadRequestException('Payment transaction has already been used');
    }

    const verification = await this.verifyPaymentTransaction({
      txSignature,
      subscriberWallet,
      payoutWallet: plan.payout_wallet,
      amount: plan.monthly_price_amount,
    });

    const periodStart = new Date();
    const periodEnd = new Date(periodStart.getTime() + BILLING_PERIOD_MS);
    const activated = await this.repository.activateWithPayment({
      subscriptionId: subscription.id,
      creatorWallet,
      subscriberWallet,
      txSignature,
      amount: plan.monthly_price_amount,
      periodStart: periodStart.toISOString(),
      periodEnd: periodEnd.toISOString(),
      verificationPayload: verification,
    });

    return this.toSubscriptionView(activated);
  }

  async listMine(subscriberWallet: string): Promise<CreatorSubscriptionView[]> {
    const rows = await this.repository.listForSubscriber(subscriberWallet);
    return rows.map((row) => this.toSubscriptionView(row));
  }

  /** Bulk plan lookup for marketplace + creator-profile read paths. */
  async listPlansByWallets(
    creatorWallets: string[],
  ): Promise<Map<string, CreatorSubscriptionPlanRow>> {
    return this.repository.listPlansByWallets(creatorWallets);
  }

  /** Active-subscriber count per creator. */
  async countActiveSubscribersByCreator(creatorWallets: string[]): Promise<Map<string, number>> {
    return this.repository.countActiveSubscribersByCreator(creatorWallets);
  }

  /** Operator-only — toggle the verified trust badge on a creator's plan. */
  async setVerifiedFlag(
    creatorWallet: string,
    verified: boolean,
  ): Promise<CreatorSubscriptionPlanRow> {
    return this.repository.setVerifiedFlag(creatorWallet, verified);
  }

  async cancel(creatorWallet: string, subscriberWallet: string): Promise<CreatorSubscriptionView> {
    return this.toSubscriptionView(
      await this.repository.cancelSubscription(creatorWallet, subscriberWallet),
    );
  }

  async hasActiveSubscription(creatorWallet: string, subscriberWallet: string): Promise<boolean> {
    if (creatorWallet === subscriberWallet) {
      return true;
    }
    return Boolean(await this.repository.maybeActiveSubscription(creatorWallet, subscriberWallet));
  }

  async assertActiveSubscription(creatorWallet: string, subscriberWallet: string): Promise<void> {
    const active = await this.hasActiveSubscription(creatorWallet, subscriberWallet);
    if (!active) {
      throw new BadRequestException('Active creator subscription required');
    }
  }

  /**
   * Verify the on-chain SOL transfer matches the listed price + payout.
   * Looks for a `system::transfer` instruction with `lamports == amount` and
   * source/destination matching subscriber/payout wallets. Native SOL only —
   * SPL transfers are rejected here even if the amount matches.
   */
  private async verifyPaymentTransaction(params: {
    txSignature: string;
    subscriberWallet: string;
    payoutWallet: string;
    amount: string;
  }): Promise<Record<string, unknown>> {
    const connection = new Connection(this.getRpcUrl(), 'confirmed');
    const tx = await connection.getParsedTransaction(params.txSignature, {
      commitment: 'confirmed',
      maxSupportedTransactionVersion: 0,
    });

    if (!tx) {
      throw new BadRequestException('Payment transaction not found or not confirmed');
    }
    if (tx.meta?.err) {
      throw new BadRequestException('Payment transaction failed on-chain');
    }

    const matchedTransfer = this.findMatchingSolTransfer(tx, params);
    if (!matchedTransfer) {
      throw new BadRequestException(
        'Payment transaction does not contain the required native SOL transfer',
      );
    }

    return {
      signature: params.txSignature,
      slot: tx.slot,
      blockTime: tx.blockTime,
      lamports: params.amount,
      source: matchedTransfer.source,
      destination: matchedTransfer.destination,
    };
  }

  private findMatchingSolTransfer(
    tx: ParsedTransactionWithMeta,
    params: { subscriberWallet: string; payoutWallet: string; amount: string },
  ): { source: string; destination: string } | null {
    const topLevel = tx.transaction.message.instructions;
    const inner = (tx.meta?.innerInstructions ?? []).flatMap((group) => group.instructions);
    for (const ix of [...topLevel, ...inner]) {
      if (!('parsed' in ix)) continue;
      const parsedIx = ix as ParsedInstruction;
      if (parsedIx.program !== 'system') continue;
      if (parsedIx.parsed?.type !== 'transfer') continue;
      const info = parsedIx.parsed?.info as Record<string, any> | undefined;
      const lamports = info?.lamports;
      if (
        info?.source === params.subscriberWallet &&
        info?.destination === params.payoutWallet &&
        String(lamports) === params.amount
      ) {
        return { source: info.source, destination: info.destination };
      }
    }
    return null;
  }

  private async ensureUserExists(walletAddress: string): Promise<void> {
    const { error } = await this.supabaseService.client.from('users').upsert(
      {
        wallet_address: walletAddress,
        last_active_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'wallet_address' },
    );
    if (error) {
      throw new InternalServerErrorException('Failed to upsert user');
    }
  }

  private getRpcUrl(): string {
    const rpcUrl = this.configService.get<string>('solana.rpcUrl');
    if (!rpcUrl) {
      throw new InternalServerErrorException('solana.rpcUrl is not configured');
    }
    return rpcUrl;
  }

  private async toPaymentIntent(
    subscription: CreatorSubscriptionRow,
    plan: CreatorSubscriptionPlanRow,
  ): Promise<CreatorSubscriptionPaymentIntent> {
    const onchainPayment = await this.buildOnchainPaymentTransaction(subscription, plan);
    return {
      subscriptionId: subscription.id,
      creatorWallet: subscription.creator_wallet,
      subscriberWallet: subscription.subscriber_wallet,
      amount: plan.monthly_price_amount,
      payoutWallet: plan.payout_wallet,
      billingPeriodDays: 30,
      onchainPayment,
    };
  }

  private async buildOnchainPaymentTransaction(
    subscription: CreatorSubscriptionRow,
    plan: CreatorSubscriptionPlanRow,
  ): Promise<CreatorSubscriptionPaymentIntent['onchainPayment']> {
    const connection = new Connection(this.getRpcUrl(), 'confirmed');
    const subscriber = new PublicKey(subscription.subscriber_wallet);
    const payoutWallet = new PublicKey(plan.payout_wallet);
    const lamports = BigInt(plan.monthly_price_amount);
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');

    const transaction = new Transaction({
      feePayer: subscriber,
      recentBlockhash: blockhash,
    }).add(
      SystemProgram.transfer({
        fromPubkey: subscriber,
        toPubkey: payoutWallet,
        lamports,
      }),
    );

    return {
      transactionBase64: transaction
        .serialize({ requireAllSignatures: false, verifySignatures: false })
        .toString('base64'),
      recentBlockhash: blockhash,
      lastValidBlockHeight,
      feePayer: subscriber.toBase58(),
    };
  }

  private toPlanView(row: CreatorSubscriptionPlanRow): CreatorSubscriptionPlanView {
    return {
      creatorWallet: row.creator_wallet,
      monthlyPriceAmount: row.monthly_price_amount,
      payoutWallet: row.payout_wallet,
      isActive: row.is_active,
      metadata: row.metadata ?? {},
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private toSubscriptionView(row: CreatorSubscriptionRow): CreatorSubscriptionView {
    return {
      id: row.id,
      creatorWallet: row.creator_wallet,
      subscriberWallet: row.subscriber_wallet,
      status: row.status,
      planPriceAmount: row.plan_price_amount,
      currentPeriodStart: row.current_period_start,
      currentPeriodEnd: row.current_period_end,
      cancelAtPeriodEnd: row.cancel_at_period_end,
      metadata: row.metadata ?? {},
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
