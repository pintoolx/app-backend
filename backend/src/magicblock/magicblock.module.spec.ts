import { Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { SupabaseService } from '../database/supabase.service';
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

const noopLogger = new Logger('test-noop');

const supabaseStub = {
  client: {
    from: jest.fn(() => ({
      insert: jest.fn().mockReturnThis(),
      update: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      neq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({ data: null, error: null }),
      maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
    })),
  },
} as unknown as SupabaseService;

async function buildModule(env: Record<string, string | undefined>): Promise<TestingModule> {
  return Test.createTestingModule({
    imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, load: [() => env] })],
    providers: [
      { provide: SupabaseService, useValue: supabaseStub },
      MagicBlockClientService,
      MagicBlockErNoopAdapter,
      MagicBlockErRealAdapter,
      MagicBlockPerClientService,
      PerGroupsRepository,
      PerAuthTokensRepository,
      MagicBlockPerNoopAdapter,
      MagicBlockPerRealAdapter,
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
          const router = config.get<string>('MAGICBLOCK_ROUTER_URL');
          return router && router.trim().length > 0 ? real : noop;
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
          const endpoint = config.get<string>('MAGICBLOCK_PER_ENDPOINT');
          return endpoint && endpoint.trim().length > 0 ? real : noop;
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
          const endpoint = config.get<string>('MAGICBLOCK_PP_ENDPOINT');
          return endpoint && endpoint.trim().length > 0 ? real : noop;
        },
      },
    ],
  })
    .setLogger(noopLogger)
    .compile();
}

describe('MagicBlockModule adapter switching', () => {
  it('uses Noop adapters when no MagicBlock env vars are set', async () => {
    const m = await buildModule({});
    expect(m.get(MAGICBLOCK_ER_ADAPTER)).toBeInstanceOf(MagicBlockErNoopAdapter);
    expect(m.get(MAGICBLOCK_PER_ADAPTER)).toBeInstanceOf(MagicBlockPerNoopAdapter);
    expect(m.get(MAGICBLOCK_PRIVATE_PAYMENTS_ADAPTER)).toBeInstanceOf(
      MagicBlockPrivatePaymentsNoopAdapter,
    );
  });

  it('uses Real ER adapter when MAGICBLOCK_ROUTER_URL is set', async () => {
    const m = await buildModule({ MAGICBLOCK_ROUTER_URL: 'https://router.example' });
    expect(m.get(MAGICBLOCK_ER_ADAPTER)).toBeInstanceOf(MagicBlockErRealAdapter);
  });

  it('uses Real PER adapter when MAGICBLOCK_PER_ENDPOINT is set', async () => {
    const m = await buildModule({ MAGICBLOCK_PER_ENDPOINT: 'https://per.example' });
    expect(m.get(MAGICBLOCK_PER_ADAPTER)).toBeInstanceOf(MagicBlockPerRealAdapter);
  });

  it('uses Real Private Payments adapter when MAGICBLOCK_PP_ENDPOINT is set', async () => {
    const m = await buildModule({ MAGICBLOCK_PP_ENDPOINT: 'https://pp.example' });
    expect(m.get(MAGICBLOCK_PRIVATE_PAYMENTS_ADAPTER)).toBeInstanceOf(
      MagicBlockPrivatePaymentsRealAdapter,
    );
  });

  it('treats blank env values as unset', async () => {
    const m = await buildModule({
      MAGICBLOCK_ROUTER_URL: '   ',
      MAGICBLOCK_PER_ENDPOINT: '   ',
      MAGICBLOCK_PP_ENDPOINT: '   ',
    });
    expect(m.get(MAGICBLOCK_ER_ADAPTER)).toBeInstanceOf(MagicBlockErNoopAdapter);
    expect(m.get(MAGICBLOCK_PER_ADAPTER)).toBeInstanceOf(MagicBlockPerNoopAdapter);
    expect(m.get(MAGICBLOCK_PRIVATE_PAYMENTS_ADAPTER)).toBeInstanceOf(
      MagicBlockPrivatePaymentsNoopAdapter,
    );
  });
});
