import { ConfigService } from '@nestjs/config';
import { HealthService } from './health.service';
import type { SupabaseService } from '../database/supabase.service';
import type { MagicBlockClientService } from '../magicblock/magicblock-client.service';

const buildSupabaseStub = (error: { message: string } | null = null) => {
  const chain = {
    select: jest.fn(() => chain),
    limit: jest.fn(async () => ({ data: [], error })),
  };
  return {
    client: {
      from: jest.fn(() => chain),
    },
  } as unknown as SupabaseService;
};

const buildMagicBlockClient = (routerUrl: string | null) =>
  ({
    getRouterUrl: () => routerUrl,
  }) as unknown as MagicBlockClientService;

const buildConfig = (env: Record<string, string | undefined>) =>
  ({
    get: jest.fn((k: string) => env[k]),
  }) as unknown as ConfigService;

describe('HealthService.readiness', () => {
  const originalGetVersion = jest.fn();

  beforeAll(() => {
    // Stub the Solana Connection so we never hit network in unit tests.
    jest.spyOn(require('@solana/web3.js'), 'Connection').mockImplementation(() => ({
      getVersion: originalGetVersion,
    }));
  });

  it('reports ok when DB query succeeds and all adapters are skipped', async () => {
    originalGetVersion.mockResolvedValue({ 'solana-core': '1.18.0' });
    const svc = new HealthService(
      buildSupabaseStub(),
      buildMagicBlockClient(null),
      buildConfig({}),
    );
    const res = await svc.readiness();
    expect(res.status).toBe('ok');
    expect(res.checks['db'].status).toBe('ok');
    expect(res.checks['magicblock-er'].status).toBe('skipped');
    expect(res.checks['magicblock-per'].status).toBe('skipped');
    expect(res.checks['magicblock-pp'].status).toBe('skipped');
    expect(res.checks['umbra'].status).toBe('skipped');
  });

  it('reports fail when DB returns an error', async () => {
    originalGetVersion.mockResolvedValue({ 'solana-core': '1.18.0' });
    const svc = new HealthService(
      buildSupabaseStub({ message: 'pg down' }),
      buildMagicBlockClient(null),
      buildConfig({}),
    );
    const res = await svc.readiness();
    expect(res.status).toBe('fail');
    expect(res.checks['db'].status).toBe('fail');
  });
});
