import { MetricsService } from './metrics.service';

describe('MetricsService', () => {
  it('records HTTP and adapter metrics into the registry', async () => {
    const svc = new MetricsService();
    svc.onModuleInit();

    svc.recordHttp('GET', '/api/health/live', 200, 0.012);
    svc.recordAdapterCall('per', 'createPermissionGroup', 'ok', 0.4);
    svc.recordAdapterCall('per', 'createPermissionGroup', 'fail', 1.2);

    const text = await svc.getRegistry().metrics();
    expect(text).toContain('http_requests_total');
    expect(text).toContain(
      'adapter_calls_total{adapter="per",op="createPermissionGroup",status="ok"} 1',
    );
    expect(text).toContain(
      'adapter_calls_total{adapter="per",op="createPermissionGroup",status="fail"} 1',
    );
  });

  it('timeAdapterCall records ok and rethrows on fail', async () => {
    const svc = new MetricsService();
    svc.onModuleInit();

    const okValue = await svc.timeAdapterCall('er', 'route', async () => 42);
    expect(okValue).toBe(42);

    await expect(
      svc.timeAdapterCall('er', 'route', async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    const text = await svc.getRegistry().metrics();
    expect(text).toContain('adapter_calls_total{adapter="er",op="route",status="ok"} 1');
    expect(text).toContain('adapter_calls_total{adapter="er",op="route",status="fail"} 1');
  });
});
