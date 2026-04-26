import { Injectable, Logger } from '@nestjs/common';
import {
  AuditLogsRepository,
  type AuditLogRow,
  type AuditQuery,
  type InsertAuditLogInput,
} from './audit-logs.repository';
import type { AdminAccessClaims } from '../auth/admin-token.service';

export interface RecordActionInput {
  admin: Pick<AdminAccessClaims, 'sub' | 'email' | 'role'> | null;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  payloadBefore?: Record<string, unknown> | null;
  payloadAfter?: Record<string, unknown> | null;
  requestId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  status: 'success' | 'failure';
  errorMessage?: string | null;
}

/**
 * Thin façade over `AuditLogsRepository`. Exposes a typed `record()` method
 * that the audit interceptor calls after every admin write — and lets
 * other admin services emit ad-hoc audit entries when they need to log
 * background actions (e.g. scheduled cleanups) outside an HTTP request.
 */
@Injectable()
export class AuditLogService {
  private readonly logger = new Logger(AuditLogService.name);

  constructor(private readonly auditLogsRepo: AuditLogsRepository) {}

  async record(input: RecordActionInput): Promise<AuditLogRow | null> {
    const payload: InsertAuditLogInput = {
      adminUserId: input.admin?.sub ?? null,
      adminEmail: input.admin?.email ?? null,
      role: input.admin?.role ?? null,
      action: input.action,
      targetType: input.targetType ?? null,
      targetId: input.targetId ?? null,
      payloadBefore: input.payloadBefore ?? null,
      payloadAfter: input.payloadAfter ?? null,
      requestId: input.requestId ?? null,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
      status: input.status,
      errorMessage: input.errorMessage ?? null,
    };
    try {
      return await this.auditLogsRepo.insert(payload);
    } catch (err) {
      // Audit logging must never break the calling action — log + swallow.
      this.logger.error(
        `Failed to persist audit log action=${input.action} target=${input.targetType}:${input.targetId}`,
        err,
      );
      return null;
    }
  }

  async list(query: AuditQuery): Promise<AuditLogRow[]> {
    return this.auditLogsRepo.list(query);
  }
}
