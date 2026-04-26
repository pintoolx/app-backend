import { ConfigService } from '@nestjs/config';
import { InternalServerErrorException } from '@nestjs/common';
import { UmbraDeploymentSignerService } from './umbra-deployment-signer.service';
import { SupabaseService } from '../database/supabase.service';

const buildHarness = (
  env: Record<string, string | undefined>,
  systemConfigSeed: string | null = null,
) => {
  const config = {
    get: jest.fn((k: string) => env[k]),
  } as unknown as ConfigService;

  const supabase = {
    client: systemConfigSeed
      ? {
          from: () => ({
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: { value: systemConfigSeed }, error: null }),
              }),
            }),
          }),
        }
      : null,
  } as unknown as SupabaseService;

  return new UmbraDeploymentSignerService(config, supabase);
};

describe('UmbraDeploymentSignerService', () => {
  it('reports configured when env seed is set', () => {
    const svc = buildHarness({ UMBRA_MASTER_SEED: 'a'.repeat(64) });
    expect(svc.isConfigured()).toBe(true);
  });

  it('throws when no master seed is configured anywhere', async () => {
    const svc = buildHarness({});
    await expect(svc.deriveForDeployment('deployment-1')).rejects.toThrow(
      InternalServerErrorException,
    );
  });

  it('produces deterministic keys for the same deployment id', async () => {
    const svc = buildHarness({ UMBRA_MASTER_SEED: 'a'.repeat(64) });
    const a = await svc.deriveForDeployment('deployment-1');
    const b = await svc.deriveForDeployment('deployment-1');
    expect(a.ed25519.publicKey.toBase58()).toBe(b.ed25519.publicKey.toBase58());
    expect(Buffer.from(a.x25519.publicKey).toString('hex')).toBe(
      Buffer.from(b.x25519.publicKey).toString('hex'),
    );
    expect(a.seedRef).toBe(b.seedRef);
  });

  it('produces different keys for different deployment ids', async () => {
    const svc = buildHarness({ UMBRA_MASTER_SEED: 'a'.repeat(64) });
    const a = await svc.deriveForDeployment('deployment-1');
    const b = await svc.deriveForDeployment('deployment-2');
    expect(a.ed25519.publicKey.toBase58()).not.toBe(b.ed25519.publicKey.toBase58());
    expect(a.seedRef).not.toBe(b.seedRef);
  });

  it('falls back to system_config when env is unset', async () => {
    const svc = buildHarness({}, 'b'.repeat(64));
    const signer = await svc.deriveForDeployment('deployment-1');
    expect(signer.ed25519.publicKey).toBeDefined();
    expect(svc.getResolvedSource()).toBe('system_config');
  });

  it('rejects empty deployment ids', async () => {
    const svc = buildHarness({ UMBRA_MASTER_SEED: 'a'.repeat(64) });
    await expect(svc.deriveForDeployment('')).rejects.toThrow(InternalServerErrorException);
  });
});
