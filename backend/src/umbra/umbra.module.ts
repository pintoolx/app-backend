import { Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseModule } from '../database/database.module';
import { UMBRA_ADAPTER, type UmbraAdapterPort } from './umbra.port';
import { UmbraNoopAdapter } from './umbra-noop.service';
import { UmbraDeploymentSignerService } from './umbra-deployment-signer.service';
import { UmbraRealAdapter } from './umbra-real.adapter';
import { UmbraClientService } from './umbra-client.service';
import { KeeperKeypairService } from '../onchain/keeper-keypair.service';

/**
 * Wires the active UmbraAdapterPort implementation under the UMBRA_ADAPTER
 * injection token.
 *
 * v2 (SDK rewrite): selection is driven by the UMBRA_ENABLED env var. When
 * UMBRA_ENABLED=true, the real adapter (backed by @umbra-privacy/sdk) is
 * wired in; otherwise the Noop adapter remains the default.
 *
 * The real adapter requires a configured keeper keypair (STRATEGY_RUNTIME_KEEPER_SECRET)
 * to act as the Umbra signer.
 */
@Module({
  imports: [DatabaseModule],
  providers: [
    UmbraNoopAdapter,
    UmbraDeploymentSignerService,
    UmbraClientService,
    UmbraRealAdapter,
    KeeperKeypairService,
    {
      provide: UMBRA_ADAPTER,
      inject: [ConfigService, UmbraRealAdapter, UmbraNoopAdapter],
      useFactory: (
        config: ConfigService,
        real: UmbraRealAdapter,
        noop: UmbraNoopAdapter,
      ): UmbraAdapterPort => {
        const logger = new Logger('UmbraModule');
        const enabled = config.get<string>('UMBRA_ENABLED') === 'true';
        if (enabled) {
          logger.log('UMBRA_ENABLED=true; using UmbraRealAdapter (SDK)');
          return real;
        }
        logger.log('UMBRA_ENABLED not set; using UmbraNoopAdapter');
        return noop;
      },
    },
  ],
  exports: [UMBRA_ADAPTER, UmbraDeploymentSignerService],
})
export class UmbraModule {}
