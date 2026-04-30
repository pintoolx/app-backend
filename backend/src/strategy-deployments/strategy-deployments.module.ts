import { Module, forwardRef } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { StrategiesModule } from '../strategies/strategies.module';
import { OnchainModule } from '../onchain/onchain.module';
import { MagicBlockModule } from '../magicblock/magicblock.module';
import { UmbraModule } from '../umbra/umbra.module';
import { StrategyKeeperModule } from '../strategy-keeper/strategy-keeper.module';
import { StrategyDeploymentsController } from './strategy-deployments.controller';
import { StrategyDeploymentsService } from './strategy-deployments.service';
import { StrategyDeploymentsRepository } from './strategy-deployments.repository';

@Module({
  imports: [AuthModule, StrategiesModule, OnchainModule, MagicBlockModule, UmbraModule, forwardRef(() => StrategyKeeperModule)],
  controllers: [StrategyDeploymentsController],
  providers: [StrategyDeploymentsService, StrategyDeploymentsRepository],
  exports: [StrategyDeploymentsService, StrategyDeploymentsRepository],
})
export class StrategyDeploymentsModule {}
