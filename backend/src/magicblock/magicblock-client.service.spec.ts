import { ConfigService } from '@nestjs/config';
import { Connection } from '@solana/web3.js';
import { MagicBlockClientService } from './magicblock-client.service';
import { InternalServerErrorException } from '@nestjs/common';

const buildHarness = (env: Record<string, string | undefined>) => {
  const config = {
    get: jest.fn((k: string) => env[k]),
  } as unknown as ConfigService;
  return new MagicBlockClientService(config);
};

describe('MagicBlockClientService', () => {
  it('reports configured when router url is set', () => {
    const svc = buildHarness({ MAGICBLOCK_ROUTER_URL: 'https://router.example' });
    expect(svc.isConfigured()).toBe(true);
    expect(svc.getRouterUrl()).toBe('https://router.example');
  });

  it('reports unconfigured when neither url is set', () => {
    const svc = buildHarness({});
    expect(svc.isConfigured()).toBe(false);
    expect(svc.getRouterUrl()).toBeNull();
    expect(svc.getErRpcUrl()).toBeNull();
  });

  it('lazy-builds the router connection only once', () => {
    const svc = buildHarness({ MAGICBLOCK_ROUTER_URL: 'https://router.example' });
    const a = svc.getRouterConnection();
    const b = svc.getRouterConnection();
    expect(a).toBe(b);
    expect(a).toBeInstanceOf(Connection);
  });

  it('throws when router url is missing', () => {
    const svc = buildHarness({});
    expect(() => svc.getRouterConnection()).toThrow(InternalServerErrorException);
    expect(() => svc.getRouterHttp()).toThrow(InternalServerErrorException);
  });

  it('rejects empty base64 transactions', async () => {
    const svc = buildHarness({ MAGICBLOCK_ROUTER_URL: 'https://router.example' });
    await expect(svc.submitBase64Transaction('')).rejects.toThrow(InternalServerErrorException);
  });

  it('rejects unparseable transactions', async () => {
    const svc = buildHarness({ MAGICBLOCK_ROUTER_URL: 'https://router.example' });
    await expect(svc.submitBase64Transaction('AAAA')).rejects.toThrow(
      'Failed to deserialise transaction payload',
    );
  });
});
