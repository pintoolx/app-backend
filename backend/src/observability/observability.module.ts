import { Global, MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { CorrelationMiddleware } from './correlation.middleware';
import { MetricsService } from './metrics.service';
import { MetricsController } from './metrics.controller';
import { HttpMetricsInterceptor } from './http-metrics.interceptor';

/**
 * Week 6.3 — Observability.
 *
 * Wires:
 *   - prom-client metrics registry (default node metrics + our custom ones).
 *   - GET /metrics exposition.
 *   - Correlation-id middleware (`X-Request-Id` -> `req.correlationId`).
 *   - HTTP-level metrics interceptor (every request -> counter + histogram).
 *
 * Adapter-level metrics live alongside individual port adapters; they call
 * `MetricsService.recordAdapterCall()` directly. We intentionally kept this
 * module decoupled from adapter implementations so the observability layer
 * can be loaded even when MagicBlock/Umbra modules are not yet wired in
 * downstream contexts (e.g. CLI scripts, partial bootstrap tests).
 */
@Global()
@Module({
  controllers: [MetricsController],
  providers: [
    MetricsService,
    {
      provide: APP_INTERCEPTOR,
      useClass: HttpMetricsInterceptor,
    },
  ],
  exports: [MetricsService],
})
export class ObservabilityModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(CorrelationMiddleware).forRoutes('*');
  }
}
