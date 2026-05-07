import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '../database/supabase.service';

export type CreatorSubscriptionStatus = 'payment_required' | 'active' | 'cancelled' | 'expired';

export interface CreatorSubscriptionPlanRow {
  creator_wallet: string;
  monthly_price_amount: string;
  payment_mint: string;
  payout_wallet: string;
  is_active: boolean;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface CreatorSubscriptionRow {
  id: string;
  creator_wallet: string;
  subscriber_wallet: string;
  status: CreatorSubscriptionStatus;
  payment_mint: string;
  plan_price_amount: string;
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface CreatorSubscriptionPaymentRow {
  id: string;
  subscription_id: string;
  creator_wallet: string;
  subscriber_wallet: string;
  tx_signature: string;
  payment_mint: string;
  amount: string;
  status: 'confirmed' | 'rejected';
  period_start: string;
  period_end: string;
  verification_payload: Record<string, unknown>;
  created_at: string;
}

const PLAN_COLUMNS =
  'creator_wallet, monthly_price_amount, payment_mint, payout_wallet, is_active, metadata, created_at, updated_at';
const SUBSCRIPTION_COLUMNS =
  'id, creator_wallet, subscriber_wallet, status, payment_mint, plan_price_amount, current_period_start, current_period_end, cancel_at_period_end, metadata, created_at, updated_at';
const PAYMENT_COLUMNS =
  'id, subscription_id, creator_wallet, subscriber_wallet, tx_signature, payment_mint, amount, status, period_start, period_end, verification_payload, created_at';

@Injectable()
export class CreatorSubscriptionsRepository {
  private readonly logger = new Logger(CreatorSubscriptionsRepository.name);

  constructor(private readonly supabaseService: SupabaseService) {}

  async upsertPlan(input: {
    creatorWallet: string;
    monthlyPriceAmount: string;
    paymentMint: string;
    payoutWallet: string;
    metadata: Record<string, unknown>;
  }): Promise<CreatorSubscriptionPlanRow> {
    const { data, error } = await this.supabaseService.client
      .from('creator_subscription_plans')
      .upsert(
        {
          creator_wallet: input.creatorWallet,
          monthly_price_amount: input.monthlyPriceAmount,
          payment_mint: input.paymentMint,
          payout_wallet: input.payoutWallet,
          is_active: true,
          metadata: input.metadata,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'creator_wallet' },
      )
      .select(PLAN_COLUMNS)
      .single();

    if (error || !data) {
      this.logger.error('Failed to upsert creator subscription plan', error);
      throw new InternalServerErrorException('Failed to upsert creator subscription plan');
    }

    return data as CreatorSubscriptionPlanRow;
  }

  async getPlan(creatorWallet: string): Promise<CreatorSubscriptionPlanRow> {
    const { data, error } = await this.supabaseService.client
      .from('creator_subscription_plans')
      .select(PLAN_COLUMNS)
      .eq('creator_wallet', creatorWallet)
      .eq('is_active', true)
      .single();

    if (error || !data) {
      throw new NotFoundException('Creator subscription plan not found');
    }

    return data as CreatorSubscriptionPlanRow;
  }

  async upsertPaymentRequiredSubscription(input: {
    creatorWallet: string;
    subscriberWallet: string;
    paymentMint: string;
    planPriceAmount: string;
  }): Promise<CreatorSubscriptionRow> {
    const { data, error } = await this.supabaseService.client
      .from('creator_subscriptions')
      .upsert(
        {
          creator_wallet: input.creatorWallet,
          subscriber_wallet: input.subscriberWallet,
          status: 'payment_required',
          payment_mint: input.paymentMint,
          plan_price_amount: input.planPriceAmount,
          cancel_at_period_end: false,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'creator_wallet,subscriber_wallet' },
      )
      .select(SUBSCRIPTION_COLUMNS)
      .single();

    if (error || !data) {
      this.logger.error('Failed to upsert creator subscription intent', error);
      throw new InternalServerErrorException('Failed to create creator subscription intent');
    }

    return data as CreatorSubscriptionRow;
  }

  async getSubscription(
    creatorWallet: string,
    subscriberWallet: string,
  ): Promise<CreatorSubscriptionRow> {
    const { data, error } = await this.supabaseService.client
      .from('creator_subscriptions')
      .select(SUBSCRIPTION_COLUMNS)
      .eq('creator_wallet', creatorWallet)
      .eq('subscriber_wallet', subscriberWallet)
      .single();

    if (error || !data) {
      throw new NotFoundException('Creator subscription not found');
    }

    return data as CreatorSubscriptionRow;
  }

  async maybeActiveSubscription(
    creatorWallet: string,
    subscriberWallet: string,
  ): Promise<CreatorSubscriptionRow | null> {
    const { data, error } = await this.supabaseService.client
      .from('creator_subscriptions')
      .select(SUBSCRIPTION_COLUMNS)
      .eq('creator_wallet', creatorWallet)
      .eq('subscriber_wallet', subscriberWallet)
      .eq('status', 'active')
      .gt('current_period_end', new Date().toISOString())
      .maybeSingle();

    if (error) {
      this.logger.error('Failed to read active creator subscription', error);
      throw new InternalServerErrorException('Failed to read creator subscription');
    }

    return (data as CreatorSubscriptionRow | null) ?? null;
  }

  async listForSubscriber(subscriberWallet: string): Promise<CreatorSubscriptionRow[]> {
    const { data, error } = await this.supabaseService.client
      .from('creator_subscriptions')
      .select(SUBSCRIPTION_COLUMNS)
      .eq('subscriber_wallet', subscriberWallet)
      .order('updated_at', { ascending: false });

    if (error) {
      this.logger.error('Failed to list creator subscriptions for subscriber', error);
      throw new InternalServerErrorException('Failed to list creator subscriptions');
    }

    return (data ?? []) as CreatorSubscriptionRow[];
  }

  async txSignatureExists(txSignature: string): Promise<boolean> {
    const { data, error } = await this.supabaseService.client
      .from('creator_subscription_payments')
      .select('id')
      .eq('tx_signature', txSignature)
      .maybeSingle();

    if (error) {
      this.logger.error('Failed to inspect creator subscription payment', error);
      throw new InternalServerErrorException('Failed to inspect payment');
    }

    return Boolean(data);
  }

  async activateWithPayment(input: {
    subscriptionId: string;
    creatorWallet: string;
    subscriberWallet: string;
    txSignature: string;
    paymentMint: string;
    amount: string;
    periodStart: string;
    periodEnd: string;
    verificationPayload: Record<string, unknown>;
  }): Promise<CreatorSubscriptionRow> {
    const { error: paymentError } = await this.supabaseService.client
      .from('creator_subscription_payments')
      .insert({
        subscription_id: input.subscriptionId,
        creator_wallet: input.creatorWallet,
        subscriber_wallet: input.subscriberWallet,
        tx_signature: input.txSignature,
        payment_mint: input.paymentMint,
        amount: input.amount,
        status: 'confirmed',
        period_start: input.periodStart,
        period_end: input.periodEnd,
        verification_payload: input.verificationPayload,
      })
      .select(PAYMENT_COLUMNS)
      .single();

    if (paymentError) {
      this.logger.error('Failed to insert creator subscription payment', paymentError);
      if (paymentError.code === '23505') {
        throw new BadRequestException('Payment transaction has already been used');
      }
      throw new InternalServerErrorException('Failed to record creator subscription payment');
    }

    const { data, error } = await this.supabaseService.client
      .from('creator_subscriptions')
      .update({
        status: 'active',
        current_period_start: input.periodStart,
        current_period_end: input.periodEnd,
        cancel_at_period_end: false,
        updated_at: new Date().toISOString(),
      })
      .eq('id', input.subscriptionId)
      .select(SUBSCRIPTION_COLUMNS)
      .single();

    if (error || !data) {
      this.logger.error('Failed to activate creator subscription', error);
      throw new InternalServerErrorException('Failed to activate creator subscription');
    }

    return data as CreatorSubscriptionRow;
  }

  async cancelSubscription(
    creatorWallet: string,
    subscriberWallet: string,
  ): Promise<CreatorSubscriptionRow> {
    const { data, error } = await this.supabaseService.client
      .from('creator_subscriptions')
      .update({
        status: 'cancelled',
        cancel_at_period_end: true,
        updated_at: new Date().toISOString(),
      })
      .eq('creator_wallet', creatorWallet)
      .eq('subscriber_wallet', subscriberWallet)
      .select(SUBSCRIPTION_COLUMNS)
      .single();

    if (error || !data) {
      throw new NotFoundException('Creator subscription not found');
    }

    return data as CreatorSubscriptionRow;
  }
}
