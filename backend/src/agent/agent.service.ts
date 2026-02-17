import { Injectable, UnauthorizedException, InternalServerErrorException, Logger } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { AuthService } from '../auth/auth.service';
import { SupabaseService } from '../database/supabase.service';

@Injectable()
export class AgentService {
  private readonly logger = new Logger(AgentService.name);

  constructor(
    private authService: AuthService,
    private supabaseService: SupabaseService,
  ) {}

  async registerAgent(walletAddress: string, signature: string): Promise<{ apiKey: string; walletAddress: string }> {
    // 1. Verify signature (same as human auth)
    const isValid = await this.authService.verifyAndConsumeChallenge(walletAddress, signature);
    if (!isValid) {
      throw new UnauthorizedException('Invalid signature or challenge expired');
    }

    // 2. Upsert user as agent type
    const { error: userError } = await this.supabaseService.client.from('users').upsert(
      {
        wallet_address: walletAddress,
        user_type: 'agent',
        last_active_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'wallet_address' },
    );

    if (userError) {
      this.logger.error('Failed to upsert agent user:', userError);
      throw new InternalServerErrorException('Failed to register agent');
    }

    // 3. Generate API Key
    const rawKey = `pt_live_${randomBytes(24).toString('hex')}`;
    const keyHash = createHash('sha256').update(rawKey).digest('hex');
    const keyPrefix = rawKey.substring(0, 12);

    // 4. Atomic key rotation (deactivate old + insert new in one transaction)
    const { error: keyError } = await this.supabaseService.client.rpc('rotate_api_key', {
      p_wallet: walletAddress,
      p_key_hash: keyHash,
      p_key_prefix: keyPrefix,
      p_name: 'Default',
    });

    if (keyError) {
      this.logger.error('Failed to rotate API key:', keyError);
      throw new InternalServerErrorException('Failed to generate API key');
    }

    this.logger.log(`✅ Agent registered: ${walletAddress}`);

    return { apiKey: rawKey, walletAddress };
  }

  async getAgentAccounts(walletAddress: string) {
    const { data, error } = await this.supabaseService.client
      .from('accounts')
      .select('id, name, crossmint_wallet_address, current_workflow_id, is_active, created_at')
      .eq('owner_wallet_address', walletAddress)
      .eq('is_active', true)
      .order('created_at', { ascending: false });

    if (error) {
      this.logger.error('Failed to fetch accounts:', error);
      throw new InternalServerErrorException('Failed to fetch accounts');
    }

    return data || [];
  }
}
