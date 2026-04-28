import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from '../database/database.module';
import { OnchainModule } from '../onchain/onchain.module';
import { HealthModule } from '../health/health.module';
import { UmbraModule } from '../umbra/umbra.module';
import { MagicBlockModule } from '../magicblock/magicblock.module';
import { StrategyDeploymentsModule } from '../strategy-deployments/strategy-deployments.module';
import { FollowerVaultsModule } from '../follower-vaults/follower-vaults.module';
import { AdminMetricsService } from './admin-metrics.service';
import { AdminAuthController } from './auth/admin-auth.controller';
import { AdminAuthService } from './auth/admin-auth.service';
import { AdminTokenService } from './auth/admin-token.service';
import { AdminUsersRepository } from './auth/admin-users.repository';
import { AdminRefreshTokensRepository } from './auth/admin-refresh-tokens.repository';
import { TotpService } from './auth/totp.service';
import { AdminJwtGuard } from './auth/admin-jwt.guard';
import { AdminRolesGuard } from './auth/admin-roles.guard';
import { AuditLogService } from './audit/audit-log.service';
import { AuditLogsRepository } from './audit/audit-logs.repository';
import { AdminAuditInterceptor } from './audit/audit.interceptor';
import { AdminAuditController } from './audit/admin-audit.controller';
import { AdminOverviewController } from './overview/admin-overview.controller';
import { AdminOverviewService } from './overview/admin-overview.service';
import { AdminUsersController } from './users/admin-users.controller';
import { AdminUsersService } from './users/admin-users.service';
import { AdminStrategiesController } from './strategies/admin-strategies.controller';
import { AdminStrategiesService } from './strategies/admin-strategies.service';
import { AdminDeploymentsController } from './deployments/admin-deployments.controller';
import { AdminDeploymentsService } from './deployments/admin-deployments.service';
import { AdminSystemController } from './system/admin-system.controller';
import { AdminSystemService } from './system/admin-system.service';
import { AdminPrivacyController } from './privacy/admin-privacy.controller';
import { AdminPrivacyService } from './privacy/admin-privacy.service';
import { AdminFollowerVaultsService } from './privacy/admin-follower-vaults.service';
import { AdminOpsService } from './ops/admin-ops.service';
import { AdminFollowerVaultsOpsService } from './ops/admin-follower-vaults-ops.service';
import { AdminDeploymentsOpsController } from './ops/admin-deployments-ops.controller';
import { AdminPrivacyOpsController } from './ops/admin-privacy-ops.controller';
import { AdminExecutionsController } from './ops/admin-executions.controller';
import { AdminUsersOpsController } from './ops/admin-users-ops.controller';
import { AdminMaintenanceController } from './ops/admin-maintenance.controller';
import { BannedWalletsRepository } from './ops/banned-wallets.repository';
import { BannedWalletsGuard } from './ops/banned-wallets.guard';
import { MaintenanceModeService } from './ops/maintenance-mode.service';
import { MaintenanceModeGuard } from './ops/maintenance-mode.guard';

/**
 * AdminModule wires the Phase 1 admin dashboard backend.
 *
 * It deliberately *re-uses* services from sibling modules (`HealthModule`,
 * `OnchainModule`) instead of reimplementing their logic. The global
 * `ThrottlerGuard` already covers admin endpoints; per-route stricter
 * limits via `@Throttle` decorators are introduced in Phase 2.
 */
@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    HealthModule,
    OnchainModule,
    UmbraModule,
    MagicBlockModule,
    StrategyDeploymentsModule,
    FollowerVaultsModule,
  ],
  controllers: [
    AdminAuthController,
    AdminAuditController,
    AdminOverviewController,
    AdminUsersController,
    AdminStrategiesController,
    AdminDeploymentsController,
    AdminSystemController,
    AdminPrivacyController,
    AdminDeploymentsOpsController,
    AdminPrivacyOpsController,
    AdminExecutionsController,
    AdminUsersOpsController,
    AdminMaintenanceController,
  ],
  providers: [
    // Auth
    AdminAuthService,
    AdminTokenService,
    TotpService,
    AdminUsersRepository,
    AdminRefreshTokensRepository,
    AdminJwtGuard,
    AdminRolesGuard,
    // Audit
    AuditLogService,
    AuditLogsRepository,
    AdminMetricsService,
    {
      provide: APP_INTERCEPTOR,
      useClass: AdminAuditInterceptor,
    },
    // Domain
    AdminOverviewService,
    AdminUsersService,
    AdminStrategiesService,
    AdminDeploymentsService,
    AdminSystemService,
    AdminPrivacyService,
    AdminFollowerVaultsService,
    // Phase 2 — Write ops
    AdminOpsService,
    AdminFollowerVaultsOpsService,
    BannedWalletsRepository,
    MaintenanceModeService,
    BannedWalletsGuard,
    MaintenanceModeGuard,
    // Apply the platform-protection guards globally. Both bypass /admin/*
    // and /health/* internally so admins are never locked out.
    {
      provide: APP_GUARD,
      useClass: BannedWalletsGuard,
    },
    {
      provide: APP_GUARD,
      useClass: MaintenanceModeGuard,
    },
  ],
  exports: [AdminMetricsService, AuditLogService, MaintenanceModeService, BannedWalletsRepository],
})
export class AdminModule {}
