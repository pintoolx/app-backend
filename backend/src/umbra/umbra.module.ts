import { Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseModule } from '../database/database.module';
import { UMBRA_ADAPTER, type UmbraAdapterPort } from './umbra.port';
import { UmbraNoopAdapter } from './umbra-noop.service';
import { UmbraDeploymentSignerService } from './umbra-deployment-signer.service';
import { UmbraRealAdapter } from './umbra-real.adapter';

/**
 * Wires the active UmbraAdapterPort implementation under the UMBRA_ADAPTER
 * injection token.
 *
 * Week 4: selection is driven by env presence. When `UMBRA_MASTER_SEED`
 * (or a system_config row of the same name) is configured, the real adapter
 * is wired in; otherwise the Noop adapter remains the default. The
 * `UMBRA_QUEUE_URL` and `UMBRA_INDEXER_URL` env vars further configure
 * whether the real adapter operates against a remote queue/indexer or in
 * local-only mode.
 */
@Module({
  imports: [DatabaseModule],
  providers: [
    UmbraNoopAdapter,
    UmbraDeploymentSignerService,
    UmbraRealAdapter,
    {
      provide: UMBRA_ADAPTER,
      inject: [ConfigService, UmbraRealAdapter, UmbraNoopAdapter],
      useFactory: (
        config: ConfigService,
        real: UmbraRealAdapter,
        noop: UmbraNoopAdapter,
      ): UmbraAdapterPort => {
        const logger = new Logger('UmbraModule');
        const seed = config.get<string>('UMBRA_MASTER_SEED');
        if (seed && seed.trim().length > 0) {
          logger.log('Using UmbraRealAdapter (UMBRA_MASTER_SEED present)');
          return real;
        }
        logger.log('UMBRA_MASTER_SEED not set; using UmbraNoopAdapter');
        return noop;
      },
    },
  ],
  exports: [UMBRA_ADAPTER, UmbraDeploymentSignerService],
})
export class UmbraModule {}
