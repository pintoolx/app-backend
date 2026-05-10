import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { SupabaseService } from '../database/supabase.service';

export interface StrategyPurchaseRow {
  id: string;
  strategy_id: string;
  buyer_wallet: string;
  price_amount: string;
  payment_tx_signature: string;
  payout_wallet: string;
  created_at: string;
}

export interface InsertStrategyPurchaseInput {
  strategyId: string;
  buyerWallet: string;
  priceAmount: string;
  paymentTxSignature: string;
  payoutWallet: string;
}

const COLUMNS =
  'id, strategy_id, buyer_wallet, price_amount, payment_tx_signature, payout_wallet, created_at';

@Injectable()
export class StrategyPurchasesRepository {
  private readonly logger = new Logger(StrategyPurchasesRepository.name);

  constructor(private readonly supabaseService: SupabaseService) {}

  async insert(input: InsertStrategyPurchaseInput): Promise<StrategyPurchaseRow> {
    const { data, error } = await this.supabaseService.client
      .from('strategy_purchases')
      .insert({
        strategy_id: input.strategyId,
        buyer_wallet: input.buyerWallet,
        price_amount: input.priceAmount,
        payment_tx_signature: input.paymentTxSignature,
        payout_wallet: input.payoutWallet,
      })
      .select(COLUMNS)
      .single();
    if (error || !data) {
      this.logger.error('Failed to insert strategy purchase', error);
      throw new InternalServerErrorException('Failed to record strategy purchase');
    }
    return data as unknown as StrategyPurchaseRow;
  }

  async getByStrategyAndBuyer(
    strategyId: string,
    buyerWallet: string,
  ): Promise<StrategyPurchaseRow | null> {
    const { data, error } = await this.supabaseService.client
      .from('strategy_purchases')
      .select(COLUMNS)
      .eq('strategy_id', strategyId)
      .eq('buyer_wallet', buyerWallet)
      .maybeSingle();
    if (error) {
      this.logger.error('Failed to fetch strategy purchase', error);
      throw new InternalServerErrorException('Failed to fetch strategy purchase');
    }
    return (data as unknown as StrategyPurchaseRow) ?? null;
  }

  async listByBuyer(buyerWallet: string): Promise<StrategyPurchaseRow[]> {
    const { data, error } = await this.supabaseService.client
      .from('strategy_purchases')
      .select(COLUMNS)
      .eq('buyer_wallet', buyerWallet)
      .order('created_at', { ascending: false });
    if (error) {
      this.logger.error('Failed to list strategy purchases', error);
      throw new InternalServerErrorException('Failed to list strategy purchases');
    }
    return (data ?? []) as unknown as StrategyPurchaseRow[];
  }

  /** Bulk lookup of strategy ids the buyer already owns — used by the marketplace `viewerOwns` flag. */
  async listOwnedStrategyIds(buyerWallet: string, strategyIds: string[]): Promise<Set<string>> {
    if (strategyIds.length === 0) return new Set();
    const { data, error } = await this.supabaseService.client
      .from('strategy_purchases')
      .select('strategy_id')
      .eq('buyer_wallet', buyerWallet)
      .in('strategy_id', strategyIds);
    if (error) {
      this.logger.error('Failed bulk ownership lookup', error);
      throw new InternalServerErrorException('Failed to load ownership set');
    }
    return new Set((data ?? []).map((row) => row.strategy_id as string));
  }

  async txSignatureExists(signature: string): Promise<boolean> {
    const { data, error } = await this.supabaseService.client
      .from('strategy_purchases')
      .select('id')
      .eq('payment_tx_signature', signature)
      .maybeSingle();
    if (error) {
      this.logger.error('Failed to check tx signature', error);
      throw new InternalServerErrorException('Failed to check payment tx signature');
    }
    return Boolean(data);
  }
}
