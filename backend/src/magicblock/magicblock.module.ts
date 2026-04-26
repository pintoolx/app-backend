import { Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseModule } from '../database/database.module';
import {
  MAGICBLOCK_ER_ADAPTER,
  MAGICBLOCK_PER_ADAPTER,
  MAGICBLOCK_PRIVATE_PAYMENTS_ADAPTER,
  type MagicBlockErAdapterPort,
  type MagicBlockPerAdapterPort,
  type MagicBlockPrivatePaymentsAdapterPort,
} from './magicblock.port';
import {
  MagicBlockErNoopAdapter,
  MagicBlockPerNoopAdapter,
  MagicBlockPrivatePaymentsNoopAdapter,
} from './magicblock-noop.service';
import { MagicBlockClientService } from './magicblock-client.service';
import { MagicBlockErRealAdapter } from './magicblock-er-real.adapter';
import { MagicBlockPerClientService } from './magicblock-per-client.service';
import { MagicBlockPerRealAdapter } from './magicblock-per-real.adapter';
import { MagicBlockPrivatePaymentsClientService } from './magicblock-private-payments-client.service';
import { MagicBlockPrivatePaymentsRealAdapter } from './magicblock-private-payments-real.adapter';
import { PerGroupsRepository } from './per-groups.repository';
import { PerAuthTokensRepository } from './per-auth-tokens.repository';

/**
 * Wires the active MagicBlock adapter implementations under their respective
 * injection tokens.
 *
 * Adapter selection is driven by env presence:
 *   - ER  : MAGICBLOCK_ROUTER_URL  set → real, else Noop (Week 4).
 *   - PER : MAGICBLOCK_PER_ENDPOINT set → real, else Noop (Week 5).
 *   - PP  : MAGICBLOCK_PP_ENDPOINT set → real, else Noop (Week 5).
 */
@Module({
  imports: [DatabaseModule],
  providers: [
    // ER
    MagicBlockClientService,
    MagicBlockErNoopAdapter,
    MagicBlockErRealAdapter,
    // PER
    MagicBlockPerClientService,
    PerGroupsRepository,
    PerAuthTokensRepository,
    MagicBlockPerNoopAdapter,
    MagicBlockPerRealAdapter,
    // Private Payments
    MagicBlockPrivatePaymentsClientService,
    MagicBlockPrivatePaymentsNoopAdapter,
    MagicBlockPrivatePaymentsRealAdapter,
    {
      provide: MAGICBLOCK_ER_ADAPTER,
      inject: [ConfigService, MagicBlockErRealAdapter, MagicBlockErNoopAdapter],
      useFactory: (
        config: ConfigService,
        real: MagicBlockErRealAdapter,
        noop: MagicBlockErNoopAdapter,
      ): MagicBlockErAdapterPort => {
        const logger = new Logger('MagicBlockModule');
        const router = config.get<string>('MAGICBLOCK_ROUTER_URL');
        if (router && router.trim().length > 0) {
          logger.log(`Using MagicBlockErRealAdapter via router=${router.trim()}`);
          return real;
        }
        logger.log('MAGICBLOCK_ROUTER_URL not set; using MagicBlockErNoopAdapter');
        return noop;
      },
    },
    {
      provide: MAGICBLOCK_PER_ADAPTER,
      inject: [ConfigService, MagicBlockPerRealAdapter, MagicBlockPerNoopAdapter],
      useFactory: (
        config: ConfigService,
        real: MagicBlockPerRealAdapter,
        noop: MagicBlockPerNoopAdapter,
      ): MagicBlockPerAdapterPort => {
        const logger = new Logger('MagicBlockModule');
        const endpoint = config.get<string>('MAGICBLOCK_PER_ENDPOINT');
        if (endpoint && endpoint.trim().length > 0) {
          logger.log(`Using MagicBlockPerRealAdapter via endpoint=${endpoint.trim()}`);
          return real;
        }
        logger.log('MAGICBLOCK_PER_ENDPOINT not set; using MagicBlockPerNoopAdapter');
        return noop;
      },
    },
    {
      provide: MAGICBLOCK_PRIVATE_PAYMENTS_ADAPTER,
      inject: [
        ConfigService,
        MagicBlockPrivatePaymentsRealAdapter,
        MagicBlockPrivatePaymentsNoopAdapter,
      ],
      useFactory: (
        config: ConfigService,
        real: MagicBlockPrivatePaymentsRealAdapter,
        noop: MagicBlockPrivatePaymentsNoopAdapter,
      ): MagicBlockPrivatePaymentsAdapterPort => {
        const logger = new Logger('MagicBlockModule');
        const endpoint = config.get<string>('MAGICBLOCK_PP_ENDPOINT');
        if (endpoint && endpoint.trim().length > 0) {
          logger.log(`Using MagicBlockPrivatePaymentsRealAdapter via endpoint=${endpoint.trim()}`);
          return real;
        }
        logger.log('MAGICBLOCK_PP_ENDPOINT not set; using MagicBlockPrivatePaymentsNoopAdapter');
        return noop;
      },
    },
  ],
  exports: [
    MAGICBLOCK_ER_ADAPTER,
    MAGICBLOCK_PER_ADAPTER,
    MAGICBLOCK_PRIVATE_PAYMENTS_ADAPTER,
    MagicBlockClientService,
    PerGroupsRepository,
    PerAuthTokensRepository,
  ],
})
export class MagicBlockModule {}
