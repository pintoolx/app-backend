import { ConfigService } from '@nestjs/config';
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import { KeeperKeypairService } from './keeper-keypair.service';
import { SupabaseService } from '../database/supabase.service';

describe('KeeperKeypairService', () => {
  function makeSupabase(value: string | null) {
    return {
      client: {
        from: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              maybeSingle: jest
                .fn()
                .mockResolvedValue({ data: value === null ? null : { value }, error: null }),
            }),
          }),
        }),
      },
    } as unknown as SupabaseService;
  }

  function configWith(env: Record<string, string | undefined>): ConfigService {
    return {
      get: jest.fn((k: string) => env[k]),
    } as unknown as ConfigService;
  }

  it('loads keypair from env in base58 format', async () => {
    const kp = Keypair.generate();
    const env = { STRATEGY_RUNTIME_KEEPER_SECRET: bs58.encode(kp.secretKey) };
    const service = new KeeperKeypairService(configWith(env), makeSupabase(null));

    const loaded = await service.loadKeypair();
    expect(loaded.publicKey.toBase58()).toBe(kp.publicKey.toBase58());
    expect(service.getResolvedSource()).toBe('env');
  });

  it('loads keypair from env in JSON-array format', async () => {
    const kp = Keypair.generate();
    const arr = JSON.stringify(Array.from(kp.secretKey));
    const env = { STRATEGY_RUNTIME_KEEPER_SECRET: arr };
    const service = new KeeperKeypairService(configWith(env), makeSupabase(null));

    const loaded = await service.loadKeypair();
    expect(loaded.publicKey.toBase58()).toBe(kp.publicKey.toBase58());
    expect(service.getResolvedSource()).toBe('env');
  });

  it('falls back to system_config when env is missing', async () => {
    const kp = Keypair.generate();
    const dbValue = bs58.encode(kp.secretKey);
    const service = new KeeperKeypairService(configWith({}), makeSupabase(dbValue));

    const loaded = await service.loadKeypair();
    expect(loaded.publicKey.toBase58()).toBe(kp.publicKey.toBase58());
    expect(service.getResolvedSource()).toBe('system_config');
  });

  it('throws when neither env nor system_config provides a value', async () => {
    const service = new KeeperKeypairService(configWith({}), makeSupabase(null));
    await expect(service.loadKeypair()).rejects.toThrow(/Keeper keypair not configured/);
  });

  it('throws on malformed env secret', async () => {
    const env = { STRATEGY_RUNTIME_KEEPER_SECRET: 'not-base58-or-json' };
    const service = new KeeperKeypairService(configWith(env), makeSupabase(null));
    await expect(service.loadKeypair()).rejects.toThrow(/Failed to parse keeper secret/);
  });

  it('caches the keypair across calls', async () => {
    const kp = Keypair.generate();
    const env = { STRATEGY_RUNTIME_KEEPER_SECRET: bs58.encode(kp.secretKey) };
    const service = new KeeperKeypairService(configWith(env), makeSupabase(null));

    const a = await service.loadKeypair();
    const b = await service.loadKeypair();
    expect(a).toBe(b);
  });
});
