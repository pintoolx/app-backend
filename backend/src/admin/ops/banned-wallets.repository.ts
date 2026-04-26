import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { SupabaseService } from '../../database/supabase.service';

export interface BannedWalletRow {
  wallet: string;
  banned_by: string;
  reason: string | null;
  banned_at: string;
  expires_at: string | null;
}

const COLUMNS = 'wallet, banned_by, reason, banned_at, expires_at';

/**
 * Storage-only access to `banned_wallets`. The guard logic lives in
 * `BannedWalletsGuard`; this repo is shared by both the admin write
 * controller and the user-facing guard so they cannot drift.
 */
@Injectable()
export class BannedWalletsRepository {
  private readonly logger = new Logger(BannedWalletsRepository.name);

  constructor(private readonly supabaseService: SupabaseService) {}

  async findByWallet(wallet: string): Promise<BannedWalletRow | null> {
    const { data, error } = await this.supabaseService.client
      .from('banned_wallets')
      .select(COLUMNS)
      .eq('wallet', wallet)
      .maybeSingle();
    if (error) {
      this.logger.warn(`banned_wallets lookup failed for ${wallet}: ${error.message}`);
      return null;
    }
    return (data as unknown as BannedWalletRow) ?? null;
  }

  async listAll(): Promise<BannedWalletRow[]> {
    const { data, error } = await this.supabaseService.client
      .from('banned_wallets')
      .select(COLUMNS)
      .order('banned_at', { ascending: false });
    if (error) {
      throw new InternalServerErrorException('Failed to list banned wallets');
    }
    return (data ?? []) as unknown as BannedWalletRow[];
  }

  async ban(input: {
    wallet: string;
    bannedBy: string;
    reason: string | null;
    expiresAt: string | null;
  }): Promise<BannedWalletRow> {
    const { data, error } = await this.supabaseService.client
      .from('banned_wallets')
      .upsert(
        {
          wallet: input.wallet,
          banned_by: input.bannedBy,
          reason: input.reason,
          expires_at: input.expiresAt,
          banned_at: new Date().toISOString(),
        },
        { onConflict: 'wallet' },
      )
      .select(COLUMNS)
      .single();
    if (error || !data) {
      this.logger.error('Failed to ban wallet', error);
      throw new InternalServerErrorException('Failed to ban wallet');
    }
    return data as unknown as BannedWalletRow;
  }

  async unban(wallet: string): Promise<void> {
    const { error } = await this.supabaseService.client
      .from('banned_wallets')
      .delete()
      .eq('wallet', wallet);
    if (error) {
      this.logger.error('Failed to unban wallet', error);
      throw new InternalServerErrorException('Failed to unban wallet');
    }
  }

  /**
   * Returns true if the wallet is currently banned (i.e. row exists and any
   * expires_at is still in the future).
   */
  async isCurrentlyBanned(wallet: string): Promise<boolean> {
    const row = await this.findByWallet(wallet);
    if (!row) return false;
    if (!row.expires_at) return true;
    return new Date(row.expires_at).getTime() > Date.now();
  }
}
