import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { UMBRA_ADAPTER, type UmbraAdapterPort } from './umbra.port';
import { UmbraNoopAdapter } from './umbra-noop.service';
import { UmbraDeploymentSignerService } from './umbra-deployment-signer.service';
import { UmbraRealAdapter } from './umbra-real.adapter';
import { SupabaseService } from '../database/supabase.service';

async function buildModule(env: Record<string, string | undefined>) {
  const fakeSupabase = {
    client: {
      from: () => ({
        select: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
        }),
      }),
    },
  } as unknown as SupabaseService;

  const moduleRef: TestingModule = await Test.createTestingModule({
    imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, load: [() => env] })],
    providers: [
      UmbraNoopAdapter,
      UmbraDeploymentSignerService,
      UmbraRealAdapter,
      { provide: SupabaseService, useValue: fakeSupabase },
      {
        provide: UMBRA_ADAPTER,
        inject: [ConfigService, UmbraRealAdapter, UmbraNoopAdapter],
        useFactory: (
          config: ConfigService,
          real: UmbraRealAdapter,
          noop: UmbraNoopAdapter,
        ): UmbraAdapterPort => {
          const seed = config.get<string>('UMBRA_MASTER_SEED');
          if (seed && seed.trim().length > 0) return real;
          return noop;
        },
      },
    ],
  }).compile();
  return moduleRef;
}

describe('UmbraModule adapter switching', () => {
  it('uses Noop adapter when UMBRA_MASTER_SEED is unset', async () => {
    const m = await buildModule({});
    expect(m.get(UMBRA_ADAPTER)).toBeInstanceOf(UmbraNoopAdapter);
  });

  it('uses Real adapter when UMBRA_MASTER_SEED is set', async () => {
    const m = await buildModule({ UMBRA_MASTER_SEED: 'a'.repeat(64) });
    expect(m.get(UMBRA_ADAPTER)).toBeInstanceOf(UmbraRealAdapter);
  });

  it('treats blank master seed as unset', async () => {
    const m = await buildModule({ UMBRA_MASTER_SEED: '   ' });
    expect(m.get(UMBRA_ADAPTER)).toBeInstanceOf(UmbraNoopAdapter);
  });
});
