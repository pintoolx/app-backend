import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../../database/supabase.service';

const LAMPORTS_PER_SOL = 1_000_000_000;
const ROW_FETCH_CAP = 50_000;

export interface AdminCreatorRosterRow {
  creatorWallet: string;
  displayName: string | null;
  verified: boolean;
  isActive: boolean;
  monthlyPriceLamports: string;
  monthlyPriceSol: number;
  payoutWallet: string;
  activeSubscribers: number;
  /** Σ plan_price_amount over this creator's active subscriptions. */
  mrrLamports: string;
  mrrSol: number;
  publishedStrategies: number;
  createdAt: string;
  updatedAt: string;
}

interface PlanRow {
  creator_wallet: string;
  monthly_price_amount: string;
  payout_wallet: string;
  is_active: boolean;
  verified: boolean;
  display_name: string | null;
  created_at: string;
  updated_at: string;
}

function toLamports(value: unknown): bigint {
  if (value == null) return 0n;
  const intPart = String(value).trim().split('.')[0];
  if (!/^-?\d+$/.test(intPart)) return 0n;
  return BigInt(intPart);
}

@Injectable()
export class AdminCreatorsService {
  private readonly logger = new Logger(AdminCreatorsService.name);

  constructor(private readonly supabaseService: SupabaseService) {}

  /**
   * Operator roster of every creator with a subscription plan, enriched with
   * live MRR, active-subscriber count and published-strategy count. Sorted by
   * MRR descending so the highest-earning creators surface first.
   */
  async listRoster(): Promise<AdminCreatorRosterRow[]> {
    const plans = await this.fetchPlans();
    if (plans.length === 0) return [];

    const [subsByCreator, strategiesByCreator] = await Promise.all([
      this.aggregateActiveSubscriptions(),
      this.countPublishedStrategies(),
    ]);

    const roster = plans.map((plan): AdminCreatorRosterRow => {
      const subs = subsByCreator.get(plan.creator_wallet) ?? { count: 0, lamports: 0n };
      const monthly = toLamports(plan.monthly_price_amount);
      return {
        creatorWallet: plan.creator_wallet,
        displayName: plan.display_name,
        verified: plan.verified,
        isActive: plan.is_active,
        monthlyPriceLamports: monthly.toString(),
        monthlyPriceSol: Number(monthly) / LAMPORTS_PER_SOL,
        payoutWallet: plan.payout_wallet,
        activeSubscribers: subs.count,
        mrrLamports: subs.lamports.toString(),
        mrrSol: Number(subs.lamports) / LAMPORTS_PER_SOL,
        publishedStrategies: strategiesByCreator.get(plan.creator_wallet) ?? 0,
        createdAt: plan.created_at,
        updatedAt: plan.updated_at,
      };
    });

    roster.sort((a, b) => {
      const am = BigInt(a.mrrLamports);
      const bm = BigInt(b.mrrLamports);
      if (bm > am) return 1;
      if (bm < am) return -1;
      return b.activeSubscribers - a.activeSubscribers;
    });
    return roster;
  }

  // ---------------------------------------------------------------- helpers

  private async fetchPlans(): Promise<PlanRow[]> {
    const { data, error } = await this.supabaseService.client
      .from('creator_subscription_plans')
      .select(
        'creator_wallet, monthly_price_amount, payout_wallet, is_active, verified, display_name, created_at, updated_at',
      )
      .order('created_at', { ascending: false })
      .limit(ROW_FETCH_CAP);
    if (error) {
      this.logger.error('Failed to list creator subscription plans', error);
      return [];
    }
    return (data ?? []) as unknown as PlanRow[];
  }

  private async aggregateActiveSubscriptions(): Promise<
    Map<string, { count: number; lamports: bigint }>
  > {
    const map = new Map<string, { count: number; lamports: bigint }>();
    const { data, error } = await this.supabaseService.client
      .from('creator_subscriptions')
      .select('creator_wallet, plan_price_amount')
      .eq('status', 'active')
      .gt('current_period_end', new Date().toISOString())
      .limit(ROW_FETCH_CAP);
    if (error) {
      this.logger.warn(`Failed to aggregate active subscriptions: ${error.message}`);
      return map;
    }
    for (const row of (data ?? []) as { creator_wallet: string; plan_price_amount: string }[]) {
      const prev = map.get(row.creator_wallet) ?? { count: 0, lamports: 0n };
      map.set(row.creator_wallet, {
        count: prev.count + 1,
        lamports: prev.lamports + toLamports(row.plan_price_amount),
      });
    }
    return map;
  }

  private async countPublishedStrategies(): Promise<Map<string, number>> {
    const map = new Map<string, number>();
    const { data, error } = await this.supabaseService.client
      .from('strategies')
      .select('creator_wallet_address')
      .eq('lifecycle_state', 'published')
      .limit(ROW_FETCH_CAP);
    if (error) {
      this.logger.warn(`Failed to count published strategies: ${error.message}`);
      return map;
    }
    for (const row of (data ?? []) as { creator_wallet_address: string }[]) {
      map.set(row.creator_wallet_address, (map.get(row.creator_wallet_address) ?? 0) + 1);
    }
    return map;
  }
}
