import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { SupabaseService } from '../../database/supabase.service';

export type AuditStatus = 'success' | 'failure';

export interface AuditLogRow {
  id: number;
  admin_user_id: string | null;
  admin_email: string | null;
  role: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  payload_before: Record<string, unknown> | null;
  payload_after: Record<string, unknown> | null;
  request_id: string | null;
  ip_address: string | null;
  user_agent: string | null;
  status: AuditStatus;
  error_message: string | null;
  created_at: string;
}

export interface InsertAuditLogInput {
  adminUserId: string | null;
  adminEmail: string | null;
  role: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  payloadBefore: Record<string, unknown> | null;
  payloadAfter: Record<string, unknown> | null;
  requestId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  status: AuditStatus;
  errorMessage: string | null;
}

export interface AuditQuery {
  adminUserId?: string;
  action?: string;
  targetType?: string;
  targetId?: string;
  status?: AuditStatus;
  from?: string;
  to?: string;
  limit?: number;
}

const COLUMNS =
  'id, admin_user_id, admin_email, role, action, target_type, target_id, payload_before, ' +
  'payload_after, request_id, ip_address, user_agent, status, error_message, created_at';

@Injectable()
export class AuditLogsRepository {
  private readonly logger = new Logger(AuditLogsRepository.name);

  constructor(private readonly supabaseService: SupabaseService) {}

  async insert(input: InsertAuditLogInput): Promise<AuditLogRow> {
    const { data, error } = await this.supabaseService.client
      .from('admin_audit_logs')
      .insert({
        admin_user_id: input.adminUserId,
        admin_email: input.adminEmail,
        role: input.role,
        action: input.action,
        target_type: input.targetType,
        target_id: input.targetId,
        payload_before: input.payloadBefore,
        payload_after: input.payloadAfter,
        request_id: input.requestId,
        ip_address: input.ipAddress,
        user_agent: input.userAgent,
        status: input.status,
        error_message: input.errorMessage,
      })
      .select(COLUMNS)
      .single();
    if (error || !data) {
      this.logger.error('Failed to insert admin audit log', error);
      throw new InternalServerErrorException('Failed to record audit log');
    }
    return data as unknown as AuditLogRow;
  }

  async list(query: AuditQuery): Promise<AuditLogRow[]> {
    let q = this.supabaseService.client
      .from('admin_audit_logs')
      .select(COLUMNS)
      .order('created_at', { ascending: false })
      .limit(Math.min(query.limit ?? 100, 500));

    if (query.adminUserId) q = q.eq('admin_user_id', query.adminUserId);
    if (query.action) q = q.eq('action', query.action);
    if (query.targetType) q = q.eq('target_type', query.targetType);
    if (query.targetId) q = q.eq('target_id', query.targetId);
    if (query.status) q = q.eq('status', query.status);
    if (query.from) q = q.gte('created_at', query.from);
    if (query.to) q = q.lte('created_at', query.to);

    const { data, error } = await q;
    if (error) {
      this.logger.error('Failed to list admin audit logs', error);
      throw new InternalServerErrorException('Failed to list audit logs');
    }
    return (data ?? []) as unknown as AuditLogRow[];
  }
}
