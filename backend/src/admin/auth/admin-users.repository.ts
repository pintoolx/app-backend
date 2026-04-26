import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '../../database/supabase.service';

export type AdminRole = 'viewer' | 'operator' | 'superadmin';
export type AdminStatus = 'active' | 'disabled';

export interface AdminUserRow {
  id: string;
  email: string;
  password_hash: string;
  totp_secret_enc: string | null;
  role: AdminRole;
  status: AdminStatus;
  failed_login_count: number;
  locked_until: string | null;
  last_login_at: string | null;
  last_login_ip: string | null;
  created_at: string;
  updated_at: string;
}

const COLUMNS =
  'id, email, password_hash, totp_secret_enc, role, status, failed_login_count, ' +
  'locked_until, last_login_at, last_login_ip, created_at, updated_at';

@Injectable()
export class AdminUsersRepository {
  private readonly logger = new Logger(AdminUsersRepository.name);

  constructor(private readonly supabaseService: SupabaseService) {}

  async findByEmail(email: string): Promise<AdminUserRow | null> {
    const { data, error } = await this.supabaseService.client
      .from('admin_users')
      .select(COLUMNS)
      .eq('email', email.trim().toLowerCase())
      .maybeSingle();
    if (error) {
      this.logger.error('Failed to load admin user by email', error);
      throw new InternalServerErrorException('Failed to load admin user');
    }
    return (data as unknown as AdminUserRow) ?? null;
  }

  async findById(id: string): Promise<AdminUserRow> {
    const { data, error } = await this.supabaseService.client
      .from('admin_users')
      .select(COLUMNS)
      .eq('id', id)
      .maybeSingle();
    if (error || !data) {
      throw new NotFoundException('Admin user not found');
    }
    return data as unknown as AdminUserRow;
  }

  async incrementFailedLogin(id: string, lockUntil: string | null): Promise<AdminUserRow> {
    const current = await this.findById(id);
    const updates: Record<string, unknown> = {
      failed_login_count: current.failed_login_count + 1,
      updated_at: new Date().toISOString(),
    };
    if (lockUntil) {
      updates.locked_until = lockUntil;
    }
    const { data, error } = await this.supabaseService.client
      .from('admin_users')
      .update(updates)
      .eq('id', id)
      .select(COLUMNS)
      .single();
    if (error || !data) {
      this.logger.error('Failed to increment admin failed_login_count', error);
      throw new InternalServerErrorException('Failed to update admin user');
    }
    return data as unknown as AdminUserRow;
  }

  async resetLoginCounters(id: string, ip: string | null): Promise<void> {
    const { error } = await this.supabaseService.client
      .from('admin_users')
      .update({
        failed_login_count: 0,
        locked_until: null,
        last_login_at: new Date().toISOString(),
        last_login_ip: ip,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);
    if (error) {
      this.logger.error('Failed to reset admin login counters', error);
      throw new InternalServerErrorException('Failed to update admin user');
    }
  }
}
