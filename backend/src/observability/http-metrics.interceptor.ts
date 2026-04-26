import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Observable, tap } from 'rxjs';
import { MetricsService } from './metrics.service';

/**
 * Week 6.3 — Per-request HTTP metrics.
 *
 * Captures method/route/status + duration and pushes both into the shared
 * Prometheus registry via {@link MetricsService}. Routes are normalized to
 * Nest's path expression (e.g. `/deployments/:id`) so cardinality stays
 * bounded; if the route is unresolvable we fall back to `unknown`.
 */
@Injectable()
export class HttpMetricsInterceptor implements NestInterceptor {
  constructor(private readonly metricsService: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    const httpCtx = context.switchToHttp();
    const req = httpCtx.getRequest<Request & { route?: { path?: string } }>();
    const res = httpCtx.getResponse<Response>();
    const t = Date.now();
    const method = req.method;
    const route = req.route?.path ?? req.path ?? 'unknown';

    return next.handle().pipe(
      tap({
        next: () => this.record(method, route, res.statusCode, t),
        error: () => this.record(method, route, 500, t),
      }),
    );
  }

  private record(method: string, route: string, status: number, startMs: number) {
    const dur = (Date.now() - startMs) / 1000;
    this.metricsService.recordHttp(method, route, status, dur);
  }
}
