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
  app_metadata?: {
    walletAddress?: unknown;
    wallet_address?: unknown;
  };
  user_metadata?: {
    walletAddress?: unknown;
    wallet_address?: unknown;
  };
};

@Injectable()
export class SupabaseJwtVerifierService {
  private readonly jwksUrl: URL;
  private readonly issuer: string;
  private readonly audience: string;
  private jwks?: unknown;

  constructor(private readonly configService: ConfigService) {
    const supabaseUrl = this.configService.get<string>('supabase.url');
    this.issuer = this.configService.get<string>('supabase.jwtIssuer');
    this.audience = this.configService.get<string>('supabase.jwtAudience') || 'authenticated';

    if (!supabaseUrl || !this.issuer) {
      throw new InternalServerErrorException('Supabase JWT configuration is missing');
    }

    this.jwksUrl = new URL(`${supabaseUrl.replace(/\/$/, '')}/auth/v1/.well-known/jwks.json`);
  }

  async verify(token: string): Promise<SupabaseJwtUser> {
    try {
      const { jwtVerify } = await import('jose');
      const payloadKeySet = await this.getJwks();
      const { payload } = await jwtVerify(token, payloadKeySet as never, {
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

  private async getJwks(): Promise<unknown> {
    if (this.jwks) {
      return this.jwks;
    }

    const { createRemoteJWKSet } = await import('jose');
    this.jwks = createRemoteJWKSet(this.jwksUrl);
    return this.jwks;
  }

  private extractWalletAddress(payload: JwtPayloadWithMetadata): string | null {
    const candidates = [
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

    return null;
  }
}
