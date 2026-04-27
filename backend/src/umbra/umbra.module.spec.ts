jest.mock('@umbra-privacy/sdk', () => ({
  getUmbraClient: jest.fn().mockResolvedValue({}),
  createSignerFromPrivateKeyBytes: jest.fn().mockResolvedValue({ address: 'mock-address' }),
}));

import { Test } from '@nestjs/testing';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { UMBRA_ADAPTER } from './umbra.port';
import { UmbraNoopAdapter } from './umbra-noop.service';
import { UmbraDeploymentSignerService } from './umbra-deployment-signer.service';
import { UmbraRealAdapter } from './umbra-real.adapter';
import { UmbraModule } from './umbra.module';

type ConfigMap = Record<string, string>;

function buildModule(configMap: ConfigMap = {}) {
  return Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, load: [() => configMap] }),
      UmbraModule,
    ],
  })
    .overrideProvider(ConfigService)
    .useFactory({
      factory: () => ({
        get: (key: string) => configMap[key] ?? null,
      }),
    })
    .compile();
}

describe('UmbraModule', () => {
  it('uses Noop adapter when UMBRA_ENABLED is unset', async () => {
    const m = await buildModule({ UMBRA_ENABLED: '' });
    expect(m.get(UMBRA_ADAPTER)).toBeInstanceOf(UmbraNoopAdapter);
  });

  it('uses Real adapter when UMBRA_ENABLED is true', async () => {
    const m = await buildModule({ UMBRA_ENABLED: 'true' });
    expect(m.get(UMBRA_ADAPTER)).toBeInstanceOf(UmbraRealAdapter);
  });

  it('uses Noop adapter when UMBRA_ENABLED is false', async () => {
    const m = await buildModule({ UMBRA_ENABLED: 'false' });
    expect(m.get(UMBRA_ADAPTER)).toBeInstanceOf(UmbraNoopAdapter);
  });

  it('exports UmbraDeploymentSignerService', async () => {
    const m = await buildModule();
    expect(m.get(UmbraDeploymentSignerService)).toBeDefined();
  });
});
