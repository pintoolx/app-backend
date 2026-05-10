import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CreatorSubscriptionsModule } from '../creator-subscriptions/creator-subscriptions.module';
import { StrategyCompilerModule } from '../strategy-compiler/strategy-compiler.module';
import { StrategiesController } from './strategies.controller';
import { StrategiesService } from './strategies.service';
import { StrategiesRepository } from './strategies.repository';
import { StrategyVersionsRepository } from './strategy-versions.repository';
import { StrategyPurchasesRepository } from './strategy-purchases.repository';
import { StrategyPermissionsService } from './strategy-permissions.service';
import { StrategyPermissionGuard } from './guards/strategy-permission.guard';

@Module({
  imports: [AuthModule, CreatorSubscriptionsModule, StrategyCompilerModule],
  controllers: [StrategiesController],
  providers: [
    StrategiesService,
    StrategiesRepository,
    StrategyVersionsRepository,
    StrategyPurchasesRepository,
    StrategyPermissionsService,
    StrategyPermissionGuard,
  ],
  exports: [
    StrategiesService,
    StrategiesRepository,
    StrategyVersionsRepository,
    StrategyPurchasesRepository,
    StrategyPermissionsService,
    StrategyPermissionGuard,
  ],
})
export class StrategiesModule {}
