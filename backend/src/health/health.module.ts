import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from '../database/database.module';
import { MagicBlockModule } from '../magicblock/magicblock.module';
import { OnchainModule } from '../onchain/onchain.module';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

/**
 * Week 6.2 — Health / readiness endpoints.
 *
 * Importing `OnchainModule` and `MagicBlockModule` here lets the readiness
 * probe call into the live adapters / clients without importing private
 * services directly (keeps boundaries clean).
 */
@Module({
  imports: [ConfigModule, DatabaseModule, OnchainModule, MagicBlockModule],
  controllers: [HealthController],
  providers: [HealthService],
  exports: [HealthService],
})
export class HealthModule {}
