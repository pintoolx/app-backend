import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { PostgrestError } from '@supabase/supabase-js';
import { AuthService } from '../auth/auth.service';
import { SupabaseService } from '../database/supabase.service';
import { ReferralCodeGeneratorService } from './referral-code-generator.service';

type ReferralCodeRow = {
  id: string;
  code: string;
  created_by_wallet: string;
  created_for_wallet: string | null;
  source_type: 'admin' | 'user';
  status: 'active' | 'used' | 'revoked' | 'expired';
  max_uses: number;
  used_count: number;
  used_by_wallet: string | null;
  used_at: string | null;
  expires_at: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

type QuotaRow = {
  wallet_address: string;
  max_codes: number;
  issued_count: number;
  created_at: string;
  updated_at: string;
};

const MAX_GENERATE_INSERT_RETRIES = 8;
const UNIQUE_VIOLATION_CODE = '23505';
const REFERRAL_CODE_SELECT_COLUMNS =
  'id, code, created_by_wallet, created_for_wallet, source_type, status, max_uses, used_count, used_by_wallet, used_at, expires_at, metadata, created_at, updated_at';

@Injectable()
export class ReferralService {
  constructor(
    private readonly authService: AuthService,
    private readonly supabaseService: SupabaseService,
    private readonly codeGenerator: ReferralCodeGeneratorService,
  ) {}

  async setUserQuota(
    adminWalletAddress: string,
    signature: string,
    targetWalletAddress: string,
    maxCodes: number,
  ): Promise<QuotaRow> {
    await this.verifySignedWallet(adminWalletAddress, signature);
    await this.assertAdmin(adminWalletAddress);
    await this.ensureUserExists(targetWalletAddress);

    const { data, error } = await this.supabaseService.client
      .from('referral_user_quotas')
      .upsert(
        {
          wallet_address: targetWalletAddress,
          max_codes: maxCodes,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'wallet_address' },
      )
      .select('wallet_address, max_codes, issued_count, created_at, updated_at')
      .single();

    if (error || !data) {
      if (error?.code === '23514') {
        throw new BadRequestException('Quota max_codes cannot be lower than current issued_count');
      }
      throw new InternalServerErrorException('Failed to set referral quota');
    }

    return data as QuotaRow;
  }

  async adminGenerateCodes(params: {
    adminWalletAddress: string;
    signature: string;
    targetWalletAddress: string;
    count: number;
    expiresAt?: string;
    metadata?: Record<string, unknown>;
  }): Promise<ReferralCodeRow[]> {
    const { adminWalletAddress, signature, targetWalletAddress, count, expiresAt, metadata } =
      params;

    await this.verifySignedWallet(adminWalletAddress, signature);
    await this.assertAdmin(adminWalletAddress);
    await this.ensureUserExists(targetWalletAddress);

    return this.generateAndPersistCodes({
      count,
      sourceType: 'admin',
      createdByWallet: adminWalletAddress,
      createdForWallet: targetWalletAddress,
      expiresAt,
      metadata,
    });
  }

  async userGenerateCodes(params: {
    walletAddress: string;
    signature: string;
    count: number;
    expiresAt?: string;
    metadata?: Record<string, unknown>;
  }): Promise<ReferralCodeRow[]> {
    const { walletAddress, signature, count, expiresAt, metadata } = params;

    await this.verifySignedWallet(walletAddress, signature);
    await this.ensureUserExists(walletAddress);

    const reserved = await this.reserveUserQuota(walletAddress, count);
    if (!reserved) {
      throw new ForbiddenException('Referral quota exceeded or not configured');
    }

    try {
      return await this.generateAndPersistCodes({
        count,
        sourceType: 'user',
        createdByWallet: walletAddress,
        expiresAt,
        metadata,
      });
    } catch (error) {
      await this.releaseUserQuota(walletAddress, count);
      throw error;
    }
  }

  async redeemCode(
    walletAddress: string,
    signature: string,
    code: string,
    metadata?: Record<string, unknown>,
  ): Promise<ReferralCodeRow> {
    await this.verifySignedWallet(walletAddress, signature);
    await this.ensureUserExists(walletAddress);

    const normalizedCode = code.trim().toUpperCase();
    if (!normalizedCode) {
      throw new BadRequestException('Referral code is required');
    }

    const { data, error } = await this.supabaseService.client.rpc('consume_referral_code', {
      p_code: normalizedCode,
      p_wallet: walletAddress,
    });

    if (error) {
      throw new InternalServerErrorException('Failed to redeem referral code');
    }

    const row = (data as ReferralCodeRow[] | null)?.[0];
    if (!row) {
      const reason = await this.inspectRedeemFailureReason(normalizedCode, walletAddress);
      throw new BadRequestException(reason);
    }

    if (metadata && Object.keys(metadata).length > 0) {
      const mergedMetadata = {
        ...(row.metadata ?? {}),
        redemption: metadata,
      };

      const { data: updated, error: updateError } = await this.supabaseService.client
        .from('referral_codes')
        .update({
          metadata: mergedMetadata,
          updated_at: new Date().toISOString(),
        })
        .eq('id', row.id)
        .select(REFERRAL_CODE_SELECT_COLUMNS)
        .single();

      if (updateError || !updated) {
        throw new InternalServerErrorException('Referral code redeemed but metadata update failed');
      }

      return updated as ReferralCodeRow;
    }

    return row;
  }

  async listMyCodes(walletAddress: string, signature: string): Promise<ReferralCodeRow[]> {
    await this.verifySignedWallet(walletAddress, signature);

    const { data, error } = await this.supabaseService.client
      .from('referral_codes')
      .select(REFERRAL_CODE_SELECT_COLUMNS)
      .eq('created_by_wallet', walletAddress)
      .order('created_at', { ascending: false });

    if (error) {
      throw new InternalServerErrorException('Failed to fetch referral codes');
    }

    return (data ?? []) as ReferralCodeRow[];
  }

  private async verifySignedWallet(walletAddress: string, signature: string): Promise<void> {
    const isValid = await this.authService.verifyAndConsumeChallenge(walletAddress, signature);
    if (!isValid) {
      throw new ForbiddenException('Invalid signature or challenge expired');
    }
  }

  private async assertAdmin(walletAddress: string): Promise<void> {
    const { data, error } = await this.supabaseService.client
      .from('users')
      .select('app_role')
      .eq('wallet_address', walletAddress)
      .single();

    if (error || !data) {
      // 42501: permission denied for table users
      if (error?.code === '42501') {
        throw new ForbiddenException('Admin permission required');
      }
      throw new ForbiddenException('Admin role not found');
    }

    if (data.app_role !== 'admin') {
      throw new ForbiddenException('Admin permission required');
    }
  }

  private async ensureUserExists(walletAddress: string): Promise<void> {
    const { error } = await this.supabaseService.client.from('users').upsert(
      {
        wallet_address: walletAddress,
        last_active_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      {
        onConflict: 'wallet_address',
      },
    );

    if (error) {
      throw new InternalServerErrorException('Failed to upsert user');
    }
  }

  private async reserveUserQuota(walletAddress: string, count: number): Promise<boolean> {
    const { data, error } = await this.supabaseService.client.rpc('reserve_referral_quota', {
      p_wallet: walletAddress,
      p_count: count,
    });

    if (error) {
      throw new InternalServerErrorException('Failed to reserve referral quota');
    }

    return Boolean(data);
  }

  private async releaseUserQuota(walletAddress: string, count: number): Promise<void> {
    const { error } = await this.supabaseService.client.rpc('release_referral_quota', {
      p_wallet: walletAddress,
      p_count: count,
    });

    if (error) {
      throw new InternalServerErrorException('Failed to release reserved referral quota');
    }
  }

  private async generateAndPersistCodes(params: {
    count: number;
    sourceType: 'admin' | 'user';
    createdByWallet: string;
    createdForWallet?: string;
    expiresAt?: string;
    metadata?: Record<string, unknown>;
  }): Promise<ReferralCodeRow[]> {
    const { count, sourceType, createdByWallet, createdForWallet, expiresAt, metadata } = params;

    for (let attempt = 0; attempt < MAX_GENERATE_INSERT_RETRIES; attempt += 1) {
      const codes = await this.codeGenerator.generate({ count });
      const insertRows = codes.map((code) => ({
        code,
        created_by_wallet: createdByWallet,
        created_for_wallet: createdForWallet ?? null,
        source_type: sourceType,
        status: 'active',
        max_uses: 1,
        used_count: 0,
        expires_at: expiresAt ?? null,
        metadata: metadata ?? {},
      }));

      const { data, error } = await this.supabaseService.client
        .from('referral_codes')
        .insert(insertRows)
        .select(REFERRAL_CODE_SELECT_COLUMNS);

      if (!error && data) {
        return data as ReferralCodeRow[];
      }

      if (!this.isUniqueViolation(error)) {
        throw new InternalServerErrorException('Failed to persist referral codes');
      }
    }

    throw new InternalServerErrorException(
      'Failed to generate unique referral codes after multiple retries',
    );
  }

  private isUniqueViolation(error: PostgrestError | null): boolean {
    if (!error) {
      return false;
    }

    return error.code === UNIQUE_VIOLATION_CODE || error.message.includes('duplicate key');
  }

  private async inspectRedeemFailureReason(code: string, walletAddress: string): Promise<string> {
    const { data, error } = await this.supabaseService.client
      .from('referral_codes')
      .select('code, status, used_count, max_uses, expires_at, created_for_wallet')
      .eq('code', code)
      .maybeSingle();

    if (error) {
      throw new InternalServerErrorException('Failed to inspect referral code state');
    }

    if (!data) {
      throw new NotFoundException('Referral code not found');
    }

    if (data.created_for_wallet && data.created_for_wallet !== walletAddress) {
      return 'Referral code is not assigned to this wallet';
    }

    if (data.expires_at && new Date(data.expires_at) <= new Date()) {
      return 'Referral code has expired';
    }

    if (data.status !== 'active') {
      return `Referral code is ${data.status}`;
    }

    if (data.used_count >= data.max_uses) {
      return 'Referral code has already been used';
    }

    return 'Referral code cannot be redeemed';
  }
}
