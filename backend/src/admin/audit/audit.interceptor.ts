import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, tap, catchError, throwError } from 'rxjs';
import type { AdminAuthRequest } from '../auth/admin-jwt.guard';
import { AuditLogService } from './audit-log.service';
import { AdminMetricsService } from '../admin-metrics.service';

export const ADMIN_AUDIT_KEY = 'admin_audit';

export interface AdminAuditMetadata {
  action: string;
  targetType?: string;
  /** Path inside route params / query / body to extract the targetId from. */
  targetIdParam?: string;
}

/**
 * Marks an admin route for automatic audit logging:
 *
 *   @AdminAudit({ action: 'deployment.pause', targetType: 'deployment', targetIdParam: 'id' })
 *   @Post('deployments/:id/pause')
 *   pause(...) { ... }
 *
 * The interceptor extracts identity from `req.admin` (set by `AdminJwtGuard`),
 * captures request body + final response, and persists a row in
 * `admin_audit_logs` after the handler resolves (or rejects).
 */
export const AdminAudit = (meta: AdminAuditMetadata) => SetMetadata(ADMIN_AUDIT_KEY, meta);

@Injectable()
export class AdminAuditInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly auditLogService: AuditLogService,
    private readonly metrics: AdminMetricsService,
  ) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const meta = this.reflector.get<AdminAuditMetadata | undefined>(
      ADMIN_AUDIT_KEY,
      ctx.getHandler(),
    );
    if (!meta) return next.handle();

    const req = ctx.switchToHttp().getRequest<AdminAuthRequest>();
    const admin = req.admin
      ? { sub: req.admin.sub, email: req.admin.email, role: req.admin.role }
      : null;
    const targetId = this.resolveTargetId(req, meta.targetIdParam);
    const requestId = AdminAuditInterceptor.extractRequestId(req);
    const ipAddress = AdminAuditInterceptor.extractIp(req);
    const userAgent = AdminAuditInterceptor.headerString(req, 'user-agent');
    const payloadBefore = this.sanitisePayload(req.body);

    return next.handle().pipe(
      tap((response) => {
        const payloadAfter = this.sanitisePayload(response);
        void this.auditLogService.record({
          admin,
          action: meta.action,
          targetType: meta.targetType ?? null,
          targetId,
          payloadBefore,
          payloadAfter,
          requestId,
          ipAddress,
          userAgent,
          status: 'success',
        });
        this.metrics.recordAdminAction(meta.action, admin?.role ?? null, 'success');
      }),
      catchError((err) => {
        const message = err instanceof Error ? err.message : String(err);
        void this.auditLogService.record({
          admin,
          action: meta.action,
          targetType: meta.targetType ?? null,
          targetId,
          payloadBefore,
          payloadAfter: null,
          requestId,
          ipAddress,
          userAgent,
          status: 'failure',
          errorMessage: message.slice(0, 1024),
        });
        this.metrics.recordAdminAction(meta.action, admin?.role ?? null, 'failure');
        return throwError(() => err);
      }),
    );
  }

  // ---------------------------------------------------------------- helpers

  private resolveTargetId(req: AdminAuthRequest, key?: string): string | null {
    if (!key) return null;
    const params = req.params as Record<string, unknown> | undefined;
    const query = req.query as Record<string, unknown> | undefined;
    const body = req.body as Record<string, unknown> | undefined;
    const candidate = params?.[key] ?? query?.[key] ?? body?.[key];
    return typeof candidate === 'string' ? candidate : null;
  }

  /**
   * Strips obvious secret-like keys from logged payloads before persisting.
   * We deliberately do not deep-clone here — Supabase storage drops
   * non-serialisable values, so a shallow copy is enough.
   */
  private sanitisePayload(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object') return null;
    const out: Record<string, unknown> = {};
    const banned = new Set([
      'password',
      'password_hash',
      'totpcode',
      'totp_code',
      'totpsecret',
      'totp_secret',
      'token',
      'temptoken',
      'temp_token',
      'refreshtoken',
      'refresh_token',
      'accesstoken',
      'access_token',
      'authorization',
      'signature',
    ]);
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (banned.has(k.toLowerCase())) {
        out[k] = '[REDACTED]';
      } else {
        out[k] = v;
      }
    }
    return out;
  }

  static headerString(req: AdminAuthRequest, name: string): string | null {
    const value = req.headers[name];
    if (typeof value === 'string') return value;
    if (Array.isArray(value) && value.length > 0) return value[0];
    return null;
  }

  static extractIp(req: AdminAuthRequest): string | null {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.length > 0) {
      const first = forwarded.split(',')[0]?.trim();
      if (first) return first;
    }
    return req.ip ?? null;
  }

  static extractRequestId(req: AdminAuthRequest): string | null {
    const candidate = (req as unknown as { correlationId?: string }).correlationId;
    if (candidate) return candidate;
    return AdminAuditInterceptor.headerString(req, 'x-request-id');
  }
}
