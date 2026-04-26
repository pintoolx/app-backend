import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ONCHAIN_ADAPTER } from './onchain-adapter.port';
import { NoopOnchainAdapter } from './noop-onchain-adapter.service';
import { AnchorOnchainAdapterService } from './anchor-onchain-adapter.service';
import { AnchorClientService } from './anchor-client.service';
import { KeeperKeypairService } from './keeper-keypair.service';
import { SupabaseService } from '../database/supabase.service';

async function buildModule(env: Record<string, string | undefined>) {
  const fakeSupabase = {
    client: {
      from: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
          }),
        }),
      }),
    },
  } as unknown as SupabaseService;

  const moduleRef: TestingModule = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({
        isGlobal: true,
        ignoreEnvFile: true,
        load: [() => env],
      }),
    ],
    providers: [
      NoopOnchainAdapter,
      KeeperKeypairService,
      AnchorClientService,
      AnchorOnchainAdapterService,
      { provide: SupabaseService, useValue: fakeSupabase },
      {
        provide: ONCHAIN_ADAPTER,
        inject: [ConfigService, AnchorOnchainAdapterService, NoopOnchainAdapter],
        useFactory: (
          config: ConfigService,
          anchor: AnchorOnchainAdapterService,
          noop: NoopOnchainAdapter,
        ) => {
          const programId = config.get<string>('STRATEGY_RUNTIME_PROGRAM_ID');
          if (programId && programId.trim().length > 0) {
            return anchor;
          }
          return noop;
        },
      },
    ],
  }).compile();

  return moduleRef;
}

describe('OnchainModule adapter switching', () => {
  it('falls back to Noop adapter when STRATEGY_RUNTIME_PROGRAM_ID is unset', async () => {
    const moduleRef = await buildModule({});
    const adapter = moduleRef.get(ONCHAIN_ADAPTER);
    expect(adapter).toBeInstanceOf(NoopOnchainAdapter);
  });

  it('selects AnchorOnchainAdapter when STRATEGY_RUNTIME_PROGRAM_ID is set', async () => {
    const moduleRef = await buildModule({
      STRATEGY_RUNTIME_PROGRAM_ID: 'FBh8hmjZYZhrhi1ionZHCVxrBbjn6s9oSGnSu3gV4vkF',
    });
    const adapter = moduleRef.get(ONCHAIN_ADAPTER);
    expect(adapter).toBeInstanceOf(AnchorOnchainAdapterService);
  });

  it('treats blank program ID as unset and falls back to Noop', async () => {
    const moduleRef = await buildModule({ STRATEGY_RUNTIME_PROGRAM_ID: '   ' });
    const adapter = moduleRef.get(ONCHAIN_ADAPTER);
    expect(adapter).toBeInstanceOf(NoopOnchainAdapter);
  });
});
