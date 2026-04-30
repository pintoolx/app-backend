import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { StrategyCompilerModule } from '../strategy-compiler/strategy-compiler.module';
import { StrategiesController } from './strategies.controller';
import { StrategiesService } from './strategies.service';
import { StrategiesRepository } from './strategies.repository';
import { StrategyVersionsRepository } from './strategy-versions.repository';
import { StrategyPermissionsService } from './strategy-permissions.service';
import { StrategyPermissionGuard } from './guards/strategy-permission.guard';

@Module({
  imports: [AuthModule, StrategyCompilerModule],
  controllers: [StrategiesController],
  providers: [
    StrategiesService,
    StrategiesRepository,
    StrategyVersionsRepository,
    StrategyPermissionsService,
    StrategyPermissionGuard,
  ],
  exports: [
    StrategiesService,
    StrategiesRepository,
    StrategyVersionsRepository,
    StrategyPermissionsService,
    StrategyPermissionGuard,
  ],
})
export class StrategiesModule {}
