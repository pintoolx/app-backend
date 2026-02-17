import { CanActivate, ExecutionContext, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { createHash } from 'crypto';
import { SupabaseService } from '../../database/supabase.service';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  private readonly logger = new Logger(ApiKeyGuard.name);

  constructor(private readonly supabaseService: SupabaseService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const request = ctx.switchToHttp().getRequest();
    const apiKey = request.headers['x-api-key'] as string | undefined;

    if (!apiKey) {
      throw new UnauthorizedException('Missing X-API-Key header');
    }

    const keyHash = createHash('sha256').update(apiKey).digest('hex');

    const { data, error } = await this.supabaseService.client
      .from('api_keys')
      .select('wallet_address, is_active')
      .eq('key_hash', keyHash)
      .single();

    if (error || !data) {
      throw new UnauthorizedException('Invalid API key');
    }

    if (!data.is_active) {
      throw new UnauthorizedException('API key is inactive');
    }

    request.agentWalletAddress = data.wallet_address;

    // Fire-and-forget: update last_used_at (safely catch errors)
    Promise.resolve(
      this.supabaseService.client
        .from('api_keys')
        .update({ last_used_at: new Date().toISOString() })
        .eq('key_hash', keyHash),
    )
      .then(({ error: updateError }) => {
        if (updateError) {
          this.logger.warn('Failed to update last_used_at:', updateError.message);
        }
      })
      .catch((e) => {
        this.logger.warn('Failed to update last_used_at:', e.message);
      });

    return true;
  }
}
