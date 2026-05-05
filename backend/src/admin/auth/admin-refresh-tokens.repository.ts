import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { SupabaseService } from '../../database/supabase.service';

export type AdminRefreshTokenStatus = 'active' | 'replaced' | 'revoked';

export interface AdminRefreshTokenRow {
  id: string;
  admin_user_id: string;
  token_hash: string;
  status: AdminRefreshTokenStatus;
  expires_at: string;
  created_at: string;
  revoked_at: string | null;
  replaced_by: string | null;
  user_agent: string | null;
  ip_address: string | null;
}

export interface InsertRefreshTokenInput {
  adminUserId: string;
  rawToken: string;
  expiresAt: string;
  userAgent: string | null;
  ipAddress: string | null;
}

export type RotateAdminRefreshTokenOutcome = 'rotated' | 'already_used' | 'expired' | 'missing';

export interface RotateRefreshTokenInput {
  oldRawToken: string;
  newRawToken: string;
  expiresAt: string;
  userAgent: string | null;
  ipAddress: string | null;
}

export interface RotateRefreshTokenResult {
  outcome: RotateAdminRefreshTokenOutcome;
  admin_user_id: string | null;
  previous_token_id: string | null;
  replacement_token_id: string | null;
  previous_status: AdminRefreshTokenStatus | null;
  previous_expires_at: string | null;
}

const COLUMNS =
  'id, admin_user_id, token_hash, status, expires_at, created_at, revoked_at, replaced_by, user_agent, ip_address';

@Injectable()
export class AdminRefreshTokensRepository {
  private readonly logger = new Logger(AdminRefreshTokensRepository.name);

  constructor(private readonly supabaseService: SupabaseService) {}

  static hashToken(raw: string): string {
    return createHash('sha256').update(raw).digest('hex');
  }

  async insert(input: InsertRefreshTokenInput): Promise<AdminRefreshTokenRow> {
    const { data, error } = await this.supabaseService.client
      .from('admin_refresh_tokens')
      .insert({
        admin_user_id: input.adminUserId,
        token_hash: AdminRefreshTokensRepository.hashToken(input.rawToken),
        status: 'active',
        expires_at: input.expiresAt,
        user_agent: input.userAgent,
        ip_address: input.ipAddress,
      })
      .select(COLUMNS)
      .single();
    if (error || !data) {
      this.logger.error('Failed to insert admin refresh token', error);
      throw new InternalServerErrorException('Failed to create refresh token');
    }
    return data as unknown as AdminRefreshTokenRow;
  }

  async findActiveByRaw(raw: string): Promise<AdminRefreshTokenRow | null> {
    const hash = AdminRefreshTokensRepository.hashToken(raw);
    const { data, error } = await this.supabaseService.client
      .from('admin_refresh_tokens')
      .select(COLUMNS)
      .eq('token_hash', hash)
      .maybeSingle();
    if (error) {
      this.logger.error('Failed to load admin refresh token', error);
      throw new InternalServerErrorException('Failed to load refresh token');
    }
    if (!data) return null;
    return data as unknown as AdminRefreshTokenRow;
  }

  async markReplaced(id: string, replacedById: string): Promise<void> {
    const { error } = await this.supabaseService.client
      .from('admin_refresh_tokens')
      .update({ status: 'replaced', replaced_by: replacedById })
      .eq('id', id);
    if (error) {
      this.logger.error('Failed to mark admin refresh token as replaced', error);
      throw new InternalServerErrorException('Failed to rotate refresh token');
    }
  }

  async rotate(input: RotateRefreshTokenInput): Promise<RotateRefreshTokenResult> {
    const { data, error } = await this.supabaseService.client.rpc('rotate_admin_refresh_token', {
      p_old_token_hash: AdminRefreshTokensRepository.hashToken(input.oldRawToken),
      p_new_token_hash: AdminRefreshTokensRepository.hashToken(input.newRawToken),
      p_expires_at: input.expiresAt,
      p_user_agent: input.userAgent,
      p_ip_address: input.ipAddress,
    });
    if (error) {
      this.logger.error('Failed to rotate admin refresh token', error);
      throw new InternalServerErrorException('Failed to rotate refresh token');
    }

    const row = Array.isArray(data) ? data[0] : data;
    if (!row) {
      return {
        outcome: 'missing',
        admin_user_id: null,
        previous_token_id: null,
        replacement_token_id: null,
        previous_status: null,
        previous_expires_at: null,
      };
    }

    return row as RotateRefreshTokenResult;
  }

  async revokeByRaw(raw: string): Promise<void> {
    const hash = AdminRefreshTokensRepository.hashToken(raw);
    const { error } = await this.supabaseService.client
      .from('admin_refresh_tokens')
      .update({ status: 'revoked', revoked_at: new Date().toISOString() })
      .eq('token_hash', hash);
    if (error) {
      this.logger.error('Failed to revoke admin refresh token', error);
      throw new InternalServerErrorException('Failed to revoke refresh token');
    }
  }

  async revokeAllForUser(adminUserId: string): Promise<void> {
    const { error } = await this.supabaseService.client
      .from('admin_refresh_tokens')
      .update({ status: 'revoked', revoked_at: new Date().toISOString() })
      .eq('admin_user_id', adminUserId)
      .neq('status', 'revoked');
    if (error) {
      this.logger.error('Failed to revoke all admin refresh tokens for user', error);
      throw new InternalServerErrorException('Failed to revoke refresh tokens');
    }
  }
}
