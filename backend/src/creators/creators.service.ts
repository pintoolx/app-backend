import { Injectable } from '@nestjs/common';
import { CreatorSubscriptionsService } from '../creator-subscriptions/creator-subscriptions.service';
import { StrategiesService } from '../strategies/strategies.service';
import { StrategiesRepository } from '../strategies/strategies.repository';

export interface CreatorProfileView {
  wallet: string;
  displayName: string | null;
  verified: boolean;
  activeSubscriberCount: number;
  publishedStrategyCount: number;
  /** Lamports — 1 SOL = 1_000_000_000. Native SOL only. */
  monthlyPriceAmount: string | null;
  payoutWallet: string | null;
  /**
   * Recently-published strategies with the same fields the marketplace
   * surfaces. Limited to 10 to keep the profile response small.
   */
  recentStrategies: Array<{
    id: string;
    name: string;
    description: string | null;
    currentVersion: number;
    updatedAt: string;
  }>;
}

@Injectable()
export class CreatorsService {
  constructor(
    private readonly creatorSubscriptionsService: CreatorSubscriptionsService,
    private readonly strategiesService: StrategiesService,
    private readonly strategiesRepository: StrategiesRepository,
  ) {}

  async getProfile(wallet: string): Promise<CreatorProfileView> {
    const [planMap, subscriberCounts, strategyRows] = await Promise.all([
      this.creatorSubscriptionsService.listPlansByWallets([wallet]),
      this.creatorSubscriptionsService.countActiveSubscribersByCreator([wallet]),
      this.strategiesRepository.listStrategiesForCreator(wallet),
    ]);
    const plan = planMap.get(wallet);
    const publishedStrategies = strategyRows.filter(
      (row) => row.lifecycle_state === 'published' && row.visibility_mode === 'public',
    );
    return {
      wallet,
      displayName: plan?.display_name ?? null,
      verified: plan?.verified ?? false,
      activeSubscriberCount: subscriberCounts.get(wallet) ?? 0,
      publishedStrategyCount: publishedStrategies.length,
      monthlyPriceAmount: plan?.monthly_price_amount ?? null,
      payoutWallet: plan?.payout_wallet ?? null,
      recentStrategies: publishedStrategies.slice(0, 10).map((row) => ({
        id: row.id,
        name: row.name,
        description: row.description,
        currentVersion: row.current_version,
        updatedAt: row.updated_at,
      })),
    };
  }
}
