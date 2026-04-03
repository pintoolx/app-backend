import { Injectable, InternalServerErrorException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { JWTPayload } from 'jose';

type SupabaseJwtUser = {
  supabaseUserId: string;
  walletAddress: string;
  email: string | null;
  role: string | null;
  claims: JWTPayload;
};

type JwtPayloadWithMetadata = JWTPayload & {
  walletAddress?: unknown;
  wallet_address?: unknown;
  email?: unknown;
  role?: unknown;
  custom_claims?: {
    address?: unknown;
    chain?: unknown;
  };
  app_metadata?: {
    walletAddress?: unknown;
    wallet_address?: unknown;
  };
  user_metadata?: {
    walletAddress?: unknown;
    wallet_address?: unknown;
    custom_claims?: {
      address?: unknown;
    };
    sub?: unknown;
  };
};

@Injectable()
export class SupabaseJwtVerifierService {
  private readonly secret: Uint8Array;
  private readonly issuer: string;
  private readonly audience: string;

  constructor(private readonly configService: ConfigService) {
    const jwtSecret = this.configService.get<string>('supabase.jwtSecret');
    this.issuer = this.configService.get<string>('supabase.jwtIssuer');
    this.audience = this.configService.get<string>('supabase.jwtAudience') || 'authenticated';

    if (!jwtSecret || !this.issuer) {
      throw new InternalServerErrorException('Supabase JWT configuration is missing');
    }

    this.secret = new TextEncoder().encode(jwtSecret);
  }

  async verify(token: string): Promise<SupabaseJwtUser> {
    try {
      const { jwtVerify } = await import('jose');
      const { payload } = await jwtVerify(token, this.secret, {
        issuer: this.issuer,
        audience: this.audience,
      });

      const jwtPayload = payload as JwtPayloadWithMetadata;
      const walletAddress = this.extractWalletAddress(jwtPayload);
      if (!walletAddress) {
        throw new UnauthorizedException('Token is missing wallet address claim');
      }

      return {
        supabaseUserId: typeof payload.sub === 'string' ? payload.sub : '',
        walletAddress,
        email: typeof jwtPayload.email === 'string' ? jwtPayload.email : null,
        role: typeof jwtPayload.role === 'string' ? jwtPayload.role : null,
        claims: payload,
      };
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      throw new UnauthorizedException('Invalid or expired token');
    }
  }

  private extractWalletAddress(payload: JwtPayloadWithMetadata): string | null {
    const candidates = [
      payload.user_metadata?.custom_claims?.address,
      payload.custom_claims?.address,
      payload.walletAddress,
      payload.wallet_address,
      payload.app_metadata?.walletAddress,
      payload.app_metadata?.wallet_address,
      payload.user_metadata?.walletAddress,
      payload.user_metadata?.wallet_address,
    ];

    for (const candidate of candidates) {
      if (typeof candidate === 'string' && candidate.trim()) {
        return candidate.trim();
      }
    }

    // Fallback: parse from user_metadata.sub (e.g. "web3:solana:<address>")
    const metaSub = payload.user_metadata?.sub;
    if (typeof metaSub === 'string') {
      const parts = metaSub.split(':');
      if (parts.length === 3 && parts[0] === 'web3' && parts[2]) {
        return parts[2];
      }
    }

    return null;
  }
}
