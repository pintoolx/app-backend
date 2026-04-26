import { ConfigService } from '@nestjs/config';
import { RuntimeConfigService } from './runtime-config.service';

const buildConfig = (env: Record<string, string | undefined>) =>
  ({
    get: jest.fn((k: string) => env[k]),
  }) as unknown as ConfigService;

describe('RuntimeConfigService.onApplicationBootstrap', () => {
  const originalEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  it('logs matrix and does not throw in development with all adapters as noop', () => {
    process.env.NODE_ENV = 'development';
    const svc = new RuntimeConfigService(buildConfig({}));
    expect(() => svc.onApplicationBootstrap()).not.toThrow();
  });

  it('throws in production when adapters are noop and override flag is unset', () => {
    process.env.NODE_ENV = 'production';
    const svc = new RuntimeConfigService(
      buildConfig({
        JWT_SECRET: 'x',
        SUPABASE_URL: 'https://example',
        SUPABASE_SERVICE_KEY: 'y',
      }),
    );
    expect(() => svc.onApplicationBootstrap()).toThrow(/noop adapters/i);
  });

  it('does not throw in production when override flag is set', () => {
    process.env.NODE_ENV = 'production';
    const svc = new RuntimeConfigService(
      buildConfig({
        JWT_SECRET: 'x',
        SUPABASE_URL: 'https://example',
        SUPABASE_SERVICE_KEY: 'y',
        STRATEGY_ALLOW_NOOP_IN_PROD: 'true',
      }),
    );
    expect(() => svc.onApplicationBootstrap()).not.toThrow();
  });

  it('throws in production when required env vars are missing', () => {
    process.env.NODE_ENV = 'production';
    const svc = new RuntimeConfigService(buildConfig({ STRATEGY_ALLOW_NOOP_IN_PROD: 'true' }));
    expect(() => svc.onApplicationBootstrap()).toThrow(/Missing required production env vars/i);
  });
});
