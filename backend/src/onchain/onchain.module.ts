import { Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseModule } from '../database/database.module';
import { ONCHAIN_ADAPTER, type OnchainAdapterPort } from './onchain-adapter.port';
import { NoopOnchainAdapter } from './noop-onchain-adapter.service';
import { AnchorOnchainAdapterService } from './anchor-onchain-adapter.service';
import { AnchorClientService } from './anchor-client.service';
import { KeeperKeypairService } from './keeper-keypair.service';

/**
 * Registers the active OnchainAdapterPort implementation under the
 * ONCHAIN_ADAPTER injection token.
 *
 * Week 3 onwards: the adapter is selected at runtime based on whether
 * `STRATEGY_RUNTIME_PROGRAM_ID` is configured. When unset (CI / local dev /
 * legacy environments) the Noop adapter remains the default so business
 * logic keeps working without a chain dependency.
 */
@Module({
  imports: [DatabaseModule],
  providers: [
    {
      provide: NoopOnchainAdapter,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => new NoopOnchainAdapter(config),
    },
    KeeperKeypairService,
    AnchorClientService,
    AnchorOnchainAdapterService,
    {
      provide: ONCHAIN_ADAPTER,
      inject: [ConfigService, AnchorOnchainAdapterService, NoopOnchainAdapter],
      useFactory: (
        config: ConfigService,
        anchor: AnchorOnchainAdapterService,
        noop: NoopOnchainAdapter,
      ): OnchainAdapterPort => {
        const logger = new Logger('OnchainModule');
        const programId = config.get<string>('STRATEGY_RUNTIME_PROGRAM_ID');
        if (programId && programId.trim().length > 0) {
          logger.log(`Using AnchorOnchainAdapter with program=${programId.trim()}`);
          return anchor;
        }
        logger.log('STRATEGY_RUNTIME_PROGRAM_ID not set; using NoopOnchainAdapter');
        return noop;
      },
    },
  ],
  exports: [ONCHAIN_ADAPTER, KeeperKeypairService],
})
export class OnchainModule {}
