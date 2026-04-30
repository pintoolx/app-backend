import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { collectDefaultMetrics, Counter, Histogram, Registry } from 'prom-client';

export type AdapterName = 'onchain' | 'er' | 'per' | 'pp' | 'umbra' | 'keeper';
export type AdapterCallStatus = 'ok' | 'fail';

/**
 * Week 6.3 — Central Prometheus registry. Exposes shared counters/histograms
 * for both HTTP and adapter-level instrumentation. Always uses a private
 * `Registry` instance so multiple Nest contexts (e.g. tests) don't fight over
 * the global one.
 */
@Injectable()
export class MetricsService implements OnModuleInit {
  private readonly logger = new Logger(MetricsService.name);
  private readonly registry = new Registry();

  readonly httpRequestsTotal = new Counter({
    name: 'http_requests_total',
    help: 'Total HTTP requests received',
    labelNames: ['method', 'route', 'status'],
    registers: [this.registry],
  });

  readonly httpRequestDurationSeconds = new Histogram({
    name: 'http_request_duration_seconds',
    help: 'HTTP request duration in seconds',
    labelNames: ['method', 'route', 'status'],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    registers: [this.registry],
  });

  readonly adapterCallsTotal = new Counter({
    name: 'adapter_calls_total',
    help: 'Total port adapter calls grouped by adapter, op, and status.',
    labelNames: ['adapter', 'op', 'status'],
    registers: [this.registry],
  });

  readonly adapterCallDurationSeconds = new Histogram({
    name: 'adapter_call_duration_seconds',
    help: 'Adapter call latency in seconds.',
    labelNames: ['adapter', 'op', 'status'],
    buckets: [0.005, 0.025, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
    registers: [this.registry],
  });

  onModuleInit() {
    collectDefaultMetrics({ register: this.registry });
    this.logger.log('Prometheus metrics registry initialised');
  }

  recordHttp(method: string, route: string, status: number, durationSec: number): void {
    const labels = { method, route, status: String(status) };
    this.httpRequestsTotal.inc(labels);
    this.httpRequestDurationSeconds.observe(labels, durationSec);
  }

  recordAdapterCall(
    adapter: AdapterName,
    op: string,
    status: AdapterCallStatus,
    durationSec: number,
  ): void {
    const labels = { adapter, op, status };
    this.adapterCallsTotal.inc(labels);
    this.adapterCallDurationSeconds.observe(labels, durationSec);
  }

  /** Convenience helper that wraps an async fn and records its adapter call. */
  async timeAdapterCall<T>(adapter: AdapterName, op: string, fn: () => Promise<T>): Promise<T> {
    const t = Date.now();
    try {
      const res = await fn();
      this.recordAdapterCall(adapter, op, 'ok', (Date.now() - t) / 1000);
      return res;
    } catch (err) {
      this.recordAdapterCall(adapter, op, 'fail', (Date.now() - t) / 1000);
      throw err;
    }
  }

  getRegistry(): Registry {
    return this.registry;
  }
}
