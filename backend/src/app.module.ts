import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import configuration from './config/configuration';
import { DatabaseModule } from './database/database.module';
import { CrossmintModule } from './crossmint/crossmint.module';
import { AuthModule } from './auth/auth.module';
import { WorkflowsModule } from './workflows/workflows.module';
import { TelegramModule } from './telegram/telegram.module';
import { Web3Module } from './web3/web3.module';
import { AgentModule } from './agent/agent.module';
import { ReferralModule } from './referral/referral.module';
import { WorkflowAiModule } from './workflow-ai/workflow-ai.module';
import { StrategiesModule } from './strategies/strategies.module';
import { StrategyDeploymentsModule } from './strategy-deployments/strategy-deployments.module';
import { OnchainModule } from './onchain/onchain.module';
import { MagicBlockModule } from './magicblock/magicblock.module';
import { UmbraModule } from './umbra/umbra.module';
import { HealthModule } from './health/health.module';
import { ObservabilityModule } from './observability/observability.module';
import { RuntimeConfigModule } from './config/runtime-config.module';
import { AdminModule } from './admin/admin.module';
import { AppController } from './app.controller';
import { RootController } from './root.controller';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
    }),
    // Week 6.4 — global rate limiting; defaults can be overridden via env.
    ThrottlerModule.forRoot([
      {
        ttl: 60_000,
        limit: 120,
      },
    ]),
    ObservabilityModule,
    RuntimeConfigModule,
    DatabaseModule,
    CrossmintModule,
    AuthModule,
    WorkflowsModule,
    TelegramModule,
    Web3Module,
    AgentModule,
    ReferralModule,
    WorkflowAiModule,
    StrategiesModule,
    OnchainModule,
    MagicBlockModule,
    UmbraModule,
    StrategyDeploymentsModule,
    HealthModule,
    AdminModule,
  ],
  controllers: [RootController, AppController],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
