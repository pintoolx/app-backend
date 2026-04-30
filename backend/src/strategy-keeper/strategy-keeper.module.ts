import { Module, forwardRef } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { StrategyKeeperService } from './strategy-keeper.service';
import { StrategyRunsService } from './strategy-runs.service';
import { StrategyRunsRepository } from './strategy-runs.repository';
import { OnchainModule } from '../onchain/onchain.module';
import { DatabaseModule } from '../database/database.module';
import { ObservabilityModule } from '../observability/observability.module';
import { StrategyDeploymentsModule } from '../strategy-deployments/strategy-deployments.module';
import { MagicBlockModule } from '../magicblock/magicblock.module';

@Module({
  imports: [
    EventEmitterModule.forRoot(),
    OnchainModule,
    DatabaseModule,
    ObservabilityModule,
    forwardRef(() => StrategyDeploymentsModule),
    MagicBlockModule,
  ],
  providers: [StrategyKeeperService, StrategyRunsService, StrategyRunsRepository],
  exports: [StrategyKeeperService, StrategyRunsService],
})
export class StrategyKeeperModule {}
