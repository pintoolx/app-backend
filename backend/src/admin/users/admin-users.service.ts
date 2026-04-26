import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '../../database/supabase.service';

export interface AdminUserListEntry {
  walletAddress: string;
  createdAt: string | null;
  lastActiveAt: string | null;
  accountCount: number;
}

export interface AdminUserDetail {
  walletAddress: string;
  createdAt: string | null;
  lastActiveAt: string | null;
  accounts: Array<{
    id: string;
    name: string;
    status: string;
    crossmintWalletAddress: string | null;
    createdAt: string;
  }>;
  strategiesCount: number;
  deploymentsCount: number;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

@Injectable()
export class AdminUsersService {
  private readonly logger = new Logger(AdminUsersService.name);

  constructor(private readonly supabaseService: SupabaseService) {}

  async listUsers(params: { search?: string; limit?: number }): Promise<AdminUserListEntry[]> {
    const limit = Math.min(Math.max(params.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
    let q = this.supabaseService.client
      .from('users')
      .select('wallet_address, created_at, last_active_at')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (params.search) {
      q = q.ilike('wallet_address', `%${params.search.trim()}%`);
    }
    const { data, error } = await q;
    if (error) {
      this.logger.error('Failed to list admin users', error);
      return [];
    }
    const users = (data ?? []) as Array<{
      wallet_address: string;
      created_at: string | null;
      last_active_at: string | null;
    }>;

    if (users.length === 0) return [];

    const accountCounts = await this.countAccountsForWallets(users.map((u) => u.wallet_address));
    return users.map((u) => ({
      walletAddress: u.wallet_address,
      createdAt: u.created_at,
      lastActiveAt: u.last_active_at,
      accountCount: accountCounts[u.wallet_address] ?? 0,
    }));
  }

  async getUserDetail(walletAddress: string): Promise<AdminUserDetail> {
    const { data: user, error } = await this.supabaseService.client
      .from('users')
      .select('wallet_address, created_at, last_active_at')
      .eq('wallet_address', walletAddress)
      .maybeSingle();
    if (error) {
      this.logger.error('Failed to load user detail', error);
      throw new NotFoundException('User not found');
    }
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const [accountsRes, strategiesCount, deploymentsCount] = await Promise.all([
      this.supabaseService.client
        .from('accounts')
        .select('id, name, status, crossmint_wallet_address, created_at')
        .eq('owner_wallet_address', walletAddress)
        .order('created_at', { ascending: false }),
      this.countRows('strategies', (q) => q.eq('creator_wallet_address', walletAddress)),
      this.countRows('strategy_deployments', (q) => q.eq('creator_wallet_address', walletAddress)),
    ]);

    const accounts = (accountsRes.data ?? []).map(
      (row: {
        id: string;
        name: string;
        status: string;
        crossmint_wallet_address: string | null;
        created_at: string;
      }) => ({
        id: row.id,
        name: row.name,
        status: row.status,
        crossmintWalletAddress: row.crossmint_wallet_address,
        createdAt: row.created_at,
      }),
    );

    return {
      walletAddress: user.wallet_address,
      createdAt: user.created_at,
      lastActiveAt: user.last_active_at,
      accounts,
      strategiesCount,
      deploymentsCount,
    };
  }

  // ---------------------------------------------------------------- helpers

  private async countRows(
    table: string,
    refine: (q: any) => any, // eslint-disable-line @typescript-eslint/no-explicit-any
  ): Promise<number> {
    const { count, error } = await refine(
      this.supabaseService.client.from(table).select('id', { count: 'exact', head: true }),
    );
    if (error) return 0;
    return count ?? 0;
  }

  private async countAccountsForWallets(wallets: string[]): Promise<Record<string, number>> {
    if (wallets.length === 0) return {};
    const { data, error } = await this.supabaseService.client
      .from('accounts')
      .select('owner_wallet_address')
      .in('owner_wallet_address', wallets);
    if (error || !data) return {};
    const counts: Record<string, number> = {};
    for (const row of data as Array<{ owner_wallet_address: string }>) {
      counts[row.owner_wallet_address] = (counts[row.owner_wallet_address] ?? 0) + 1;
    }
    return counts;
  }
}
