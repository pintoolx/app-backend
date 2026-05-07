import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  type AccountMeta,
  Connection,
  ParsedInstruction,
  ParsedTransactionWithMeta,
  PublicKey,
  Transaction,
} from '@solana/web3.js';
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import { SupabaseService } from '../database/supabase.service';
import {
  CreatorSubscriptionsRepository,
  type CreatorSubscriptionPlanRow,
  type CreatorSubscriptionRow,
} from './creator-subscriptions.repository';

const BILLING_PERIOD_MS = 30 * 24 * 60 * 60 * 1000;

export interface CreatorSubscriptionPlanView {
  creatorWallet: string;
  monthlyPriceAmount: string;
  paymentMint: string;
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
  paymentMint: string;
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
  paymentMint: string;
  amount: string;
  payoutWallet: string;
  billingPeriodDays: 30;
  onchainPayment: {
    transactionBase64: string;
    recentBlockhash: string;
    lastValidBlockHeight: number;
    feePayer: string;
    sourceTokenAccount: string;
    destinationTokenAccount: string;
    requiredSigners: string[];
    instructionCount: number;
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
    const paymentMint = this.getPaymentMint();
    const payoutWallet = params.payoutWallet ?? creatorWallet;

    await this.ensureUserExists(creatorWallet);
    await this.ensureUserExists(payoutWallet);

    const row = await this.repository.upsertPlan({
      creatorWallet,
      monthlyPriceAmount: params.monthlyPriceAmount,
      paymentMint,
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
  ): Promise<{ subscription: CreatorSubscriptionView; paymentIntent: CreatorSubscriptionPaymentIntent }> {
    if (creatorWallet === subscriberWallet) {
      throw new BadRequestException('Creators do not need to subscribe to themselves');
    }
    await this.ensureUserExists(subscriberWallet);
    const plan = await this.repository.getPlan(creatorWallet);
    if (plan.payment_mint !== this.getPaymentMint()) {
      throw new BadRequestException('Creator plan payment mint is not supported on this cluster');
    }

    const subscription = await this.repository.upsertPaymentRequiredSubscription({
      creatorWallet,
      subscriberWallet,
      paymentMint: plan.payment_mint,
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
      paymentMint: plan.payment_mint,
      amount: plan.monthly_price_amount,
    });

    const periodStart = new Date();
    const periodEnd = new Date(periodStart.getTime() + BILLING_PERIOD_MS);
    const activated = await this.repository.activateWithPayment({
      subscriptionId: subscription.id,
      creatorWallet,
      subscriberWallet,
      txSignature,
      paymentMint: plan.payment_mint,
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

  private async verifyPaymentTransaction(params: {
    txSignature: string;
    subscriberWallet: string;
    payoutWallet: string;
    paymentMint: string;
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

    const matchedTransfer = this.findMatchingTokenTransfer(tx, params);
    if (!matchedTransfer) {
      throw new BadRequestException('Payment transaction does not contain the required USDC transfer');
    }

    const destinationOwner = await this.resolveTokenAccountOwner(
      connection,
      tx,
      matchedTransfer.destination,
    );
    if (destinationOwner !== params.payoutWallet) {
      throw new BadRequestException('Payment recipient does not match creator payout wallet');
    }

    return {
      signature: params.txSignature,
      slot: tx.slot,
      blockTime: tx.blockTime,
      mint: params.paymentMint,
      amount: params.amount,
      authority: matchedTransfer.authority,
      destination: matchedTransfer.destination,
      destinationOwner,
    };
  }

  private findMatchingTokenTransfer(
    tx: ParsedTransactionWithMeta,
    params: { subscriberWallet: string; paymentMint: string; amount: string },
  ): { authority: string; destination: string } | null {
    const topLevel = tx.transaction.message.instructions;
    const inner = (tx.meta?.innerInstructions ?? []).flatMap((group) => group.instructions);
    for (const ix of [...topLevel, ...inner]) {
      if (!('parsed' in ix)) continue;
      const parsedIx = ix as ParsedInstruction;
      if (parsedIx.program !== 'spl-token') continue;
      const info = parsedIx.parsed?.info as Record<string, any> | undefined;
      const type = parsedIx.parsed?.type;
      const amount = info?.tokenAmount?.amount ?? info?.amount;
      const authority = info?.authority ?? info?.multisigAuthority;
      if (
        (type === 'transfer' || type === 'transferChecked') &&
        info?.mint === params.paymentMint &&
        amount === params.amount &&
        authority === params.subscriberWallet &&
        typeof info?.destination === 'string'
      ) {
        return { authority, destination: info.destination };
      }
    }
    return null;
  }

  private async resolveTokenAccountOwner(
    connection: Connection,
    tx: ParsedTransactionWithMeta,
    tokenAccount: string,
  ): Promise<string | null> {
    const index = tx.transaction.message.accountKeys.findIndex(
      (key) => key.pubkey.toBase58() === tokenAccount,
    );
    const balanceOwner = [...(tx.meta?.postTokenBalances ?? []), ...(tx.meta?.preTokenBalances ?? [])].find(
      (balance) => balance.accountIndex === index && balance.owner,
    )?.owner;
    if (balanceOwner) {
      return balanceOwner;
    }

    try {
      const account = await connection.getParsedAccountInfo(new PublicKey(tokenAccount), 'confirmed');
      const value = account.value?.data;
      if (value && typeof value === 'object' && 'parsed' in value) {
        return (value.parsed as any)?.info?.owner ?? null;
      }
    } catch (err) {
      this.logger.warn(
        `Failed to resolve token account owner for ${tokenAccount}: ${err instanceof Error ? err.message : err}`,
      );
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

  private getPaymentMint(): string {
    const mint = this.configService.get<string>('CREATOR_SUBSCRIPTION_USDC_MINT');
    if (!mint) {
      throw new InternalServerErrorException(
        'CREATOR_SUBSCRIPTION_USDC_MINT env var not configured',
      );
    }
    return mint;
  }

  private getRpcUrl(): string {
    const rpcUrl = this.configService.get<string>('SOLANA_RPC_URL');
    if (!rpcUrl) {
      throw new InternalServerErrorException('SOLANA_RPC_URL env var not configured');
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
      paymentMint: plan.payment_mint,
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
    const mint = new PublicKey(plan.payment_mint);
    const decimals = this.getPaymentMintDecimals();

    const sourceTokenAccount = getAssociatedTokenAddressSync(mint, subscriber);
    const destinationTokenAccount = getAssociatedTokenAddressSync(mint, payoutWallet);
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');

    const transaction = new Transaction({
      feePayer: subscriber,
      recentBlockhash: blockhash,
    }).add(
      createAssociatedTokenAccountIdempotentInstruction(
        subscriber,
        destinationTokenAccount,
        payoutWallet,
        mint,
      ),
      createTransferCheckedInstruction(
        sourceTokenAccount,
        mint,
        destinationTokenAccount,
        subscriber,
        BigInt(plan.monthly_price_amount),
        decimals,
      ),
    );

    return {
      transactionBase64: transaction
        .serialize({ requireAllSignatures: false, verifySignatures: false })
        .toString('base64'),
      recentBlockhash: blockhash,
      lastValidBlockHeight,
      feePayer: subscriber.toBase58(),
      sourceTokenAccount: sourceTokenAccount.toBase58(),
      destinationTokenAccount: destinationTokenAccount.toBase58(),
      requiredSigners: this.uniqueSignerPubkeys(transaction.instructions.flatMap((ix) => ix.keys)),
      instructionCount: transaction.instructions.length,
    };
  }

  private getPaymentMintDecimals(): number {
    const raw = this.configService.get<string>('CREATOR_SUBSCRIPTION_USDC_DECIMALS') ?? '6';
    const decimals = Number(raw);
    if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) {
      throw new InternalServerErrorException('Invalid CREATOR_SUBSCRIPTION_USDC_DECIMALS env var');
    }
    return decimals;
  }

  private uniqueSignerPubkeys(keys: AccountMeta[]): string[] {
    return Array.from(new Set(keys.filter((key) => key.isSigner).map((key) => key.pubkey.toBase58())));
  }

  private toPlanView(row: CreatorSubscriptionPlanRow): CreatorSubscriptionPlanView {
    return {
      creatorWallet: row.creator_wallet,
      monthlyPriceAmount: row.monthly_price_amount,
      paymentMint: row.payment_mint,
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
      paymentMint: row.payment_mint,
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
