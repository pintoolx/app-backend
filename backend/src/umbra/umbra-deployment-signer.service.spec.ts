jest.mock('@umbra-privacy/sdk', () => ({
  getUmbraClient: jest.fn(),
  createSignerFromPrivateKeyBytes: jest.fn(),
}));

import { ConfigService } from '@nestjs/config';
import { UmbraDeploymentSignerService } from './umbra-deployment-signer.service';
import { UmbraClientService } from './umbra-client.service';

function buildHarness(configMap: Record<string, string> = {}) {
  const config = {
    get: (key: string) => configMap[key] ?? null,
  } as unknown as ConfigService;

  const clientService = {
    isEnabled: () => configMap['UMBRA_ENABLED'] === 'true',
  } as unknown as UmbraClientService;

  return new UmbraDeploymentSignerService(config, clientService);
}

describe('UmbraDeploymentSignerService', () => {
  it('isConfigured returns true when UMBRA_ENABLED=true', () => {
    const svc = buildHarness({ UMBRA_ENABLED: 'true' });
    expect(svc.isConfigured()).toBe(true);
  });

  it('isConfigured returns false when UMBRA_ENABLED is unset', () => {
    const svc = buildHarness({});
    expect(svc.isConfigured()).toBe(false);
  });

  it('getResolvedSource returns keeper when configured', () => {
    const svc = buildHarness({ UMBRA_ENABLED: 'true' });
    expect(svc.getResolvedSource()).toBe('keeper');
  });

  it('getResolvedSource returns null when not configured', () => {
    const svc = buildHarness({});
    expect(svc.getResolvedSource()).toBeNull();
  });
});
