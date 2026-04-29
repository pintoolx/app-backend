import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { OnchainModule } from '../onchain/onchain.module';
import { MagicBlockModule } from '../magicblock/magicblock.module';
import { UmbraModule } from '../umbra/umbra.module';
import { StrategyDeploymentsModule } from '../strategy-deployments/strategy-deployments.module';
import { StrategySubscriptionsRepository } from './subscriptions.repository';
import { FollowerVaultsRepository } from './follower-vaults.repository';
import { FollowerVaultUmbraIdentitiesRepository } from './follower-vault-umbra-identities.repository';
import { FollowerVisibilityGrantsRepository } from './follower-visibility-grants.repository';
import { PrivateExecutionCyclesRepository } from './private-execution-cycles.repository';
import { FollowerExecutionReceiptsRepository } from './follower-execution-receipts.repository';
import { FollowerVaultSignerService } from './follower-vault-signer.service';
import { FollowerVaultAllocationsService } from './follower-vault-allocations.service';
import { SubscriptionsService } from './subscriptions.service';
import { SubscriptionsController } from './subscriptions.controller';
import { MySubscriptionsController } from './my-subscriptions.controller';
import { PrivateExecutionCyclesService } from './private-execution-cycles.service';
import { PrivateExecutionCyclesController } from './private-execution-cycles.controller';

/**
 * Native Privacy Phase 1 — follower-vault domain.
 *
 * Imports `StrategyDeploymentsModule` so we can re-use its repository to
 * resolve and authorize parent deployments without re-implementing the
 * `creator_wallet_address` + `getForCreator` checks. `OnchainModule` is
 * imported for `KeeperKeypairService`, used by the HKDF signer derivation.
 */
@Module({
  imports: [AuthModule, OnchainModule, MagicBlockModule, UmbraModule, StrategyDeploymentsModule],
  controllers: [
    SubscriptionsController,
    MySubscriptionsController,
    PrivateExecutionCyclesController,
  ],
  providers: [
    StrategySubscriptionsRepository,
    FollowerVaultsRepository,
    FollowerVaultUmbraIdentitiesRepository,
    FollowerVisibilityGrantsRepository,
    PrivateExecutionCyclesRepository,
    FollowerExecutionReceiptsRepository,
    FollowerVaultSignerService,
    FollowerVaultAllocationsService,
    SubscriptionsService,
    PrivateExecutionCyclesService,
  ],
  exports: [
    StrategySubscriptionsRepository,
    FollowerVaultsRepository,
    FollowerVaultUmbraIdentitiesRepository,
    FollowerVisibilityGrantsRepository,
    PrivateExecutionCyclesRepository,
    FollowerExecutionReceiptsRepository,
    SubscriptionsService,
    PrivateExecutionCyclesService,
  ],
})
export class FollowerVaultsModule {}
