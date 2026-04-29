import {
  Injectable,
  InternalServerErrorException,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { SupabaseService } from '../database/supabase.service';

export type PerAuthTokenStatus = 'challenge' | 'active' | 'revoked';

/**
 * Phase-1 follower-vault privacy: PER tokens are now scoped either to the
 * whole deployment (creator/operator/auditor) or to a single follower
 * subscription (subscriber-self private-state read).
 */
export type PerAuthTokenScopeKind = 'deployment' | 'subscription';

export interface PerAuthTokenRow {
  token: string;
  deployment_id: string;
  wallet: string;
  group_id: string | null;
  /**
   * Defaults to 'deployment' for legacy rows so guards keep behaving the
   * same. New follower-self tokens explicitly set 'subscription' and bind a
   * `subscription_id`.
   */
  scope_kind: PerAuthTokenScopeKind;
  subscription_id: string | null;
  status: PerAuthTokenStatus;
  scopes: string[];
  issued_at: string;
  expires_at: string;
  revoked_at: string | null;
}

export interface InsertChallengeInput {
  token: string;
  deploymentId: string;
  wallet: string;
  groupId: string | null;
  expiresAt: string;
  scopes?: string[];
  scopeKind?: PerAuthTokenScopeKind;
  subscriptionId?: string | null;
}

export interface InsertActiveInput {
  token: string;
  deploymentId: string;
  wallet: string;
  groupId: string | null;
  expiresAt: string;
  scopes?: string[];
  scopeKind?: PerAuthTokenScopeKind;
  subscriptionId?: string | null;
}

const COLUMNS =
  'token, deployment_id, wallet, group_id, scope_kind, subscription_id, status, scopes, issued_at, expires_at, revoked_at';

@Injectable()
export class PerAuthTokensRepository {
  private readonly logger = new Logger(PerAuthTokensRepository.name);

  constructor(private readonly supabaseService: SupabaseService) {}

  async insertChallenge(input: InsertChallengeInput): Promise<PerAuthTokenRow> {
    return this.insertRow({ ...input, status: 'challenge' });
  }

  async insertActive(input: InsertActiveInput): Promise<PerAuthTokenRow> {
    return this.insertRow({ ...input, status: 'active' });
  }

  async getByToken(token: string): Promise<PerAuthTokenRow | null> {
    const { data, error } = await this.supabaseService.client
      .from('per_auth_tokens')
      .select(COLUMNS)
      .eq('token', token)
      .maybeSingle();
    if (error) {
      this.logger.error('Failed to fetch PER auth token', error);
      throw new InternalServerErrorException('Failed to fetch auth token');
    }
    return (data as unknown as PerAuthTokenRow) ?? null;
  }

  /**
   * Returns the row only if `status === 'active'`, `expires_at` is in the
   * future, and `revoked_at` is null. Throws UnauthorizedException otherwise
   * (so guards can map straight to 401).
   */
  async getActiveOrThrow(token: string): Promise<PerAuthTokenRow> {
    const row = await this.getByToken(token);
    if (!row) {
      throw new UnauthorizedException('PER auth token not found');
    }
    if (row.status !== 'active') {
      throw new UnauthorizedException(`PER auth token is ${row.status}`);
    }
    if (row.revoked_at) {
      throw new UnauthorizedException('PER auth token revoked');
    }
    if (new Date(row.expires_at).getTime() <= Date.now()) {
      throw new UnauthorizedException('PER auth token expired');
    }
    return row;
  }

  async promoteChallenge(token: string, expiresAt: string): Promise<PerAuthTokenRow> {
    const { data, error } = await this.supabaseService.client
      .from('per_auth_tokens')
      .update({ status: 'active', expires_at: expiresAt, issued_at: new Date().toISOString() })
      .eq('token', token)
      .eq('status', 'challenge')
      .select(COLUMNS)
      .single();
    if (error || !data) {
      this.logger.error('Failed to promote PER challenge to active token', error);
      throw new UnauthorizedException(
        'Challenge token cannot be promoted (already used or expired)',
      );
    }
    return data as unknown as PerAuthTokenRow;
  }

  async revokeToken(token: string): Promise<void> {
    const { error } = await this.supabaseService.client
      .from('per_auth_tokens')
      .update({ status: 'revoked', revoked_at: new Date().toISOString() })
      .eq('token', token);
    if (error) {
      this.logger.error('Failed to revoke PER auth token', error);
      throw new InternalServerErrorException('Failed to revoke auth token');
    }
  }

  async revokeAllForDeployment(deploymentId: string): Promise<void> {
    const { error } = await this.supabaseService.client
      .from('per_auth_tokens')
      .update({ status: 'revoked', revoked_at: new Date().toISOString() })
      .eq('deployment_id', deploymentId)
      .neq('status', 'revoked');
    if (error) {
      this.logger.error('Failed to revoke deployment tokens', error);
      throw new InternalServerErrorException('Failed to revoke deployment tokens');
    }
  }

  /**
   * Phase-1 hardening: revoke every still-live subscription-scoped token for
   * a given subscription. Used when a follower transitions into
   * `exiting`/`closed` so an issued PER token cannot keep reading state
   * after the subscription ends.
   */
  async revokeAllForSubscription(subscriptionId: string): Promise<void> {
    const { error } = await this.supabaseService.client
      .from('per_auth_tokens')
      .update({ status: 'revoked', revoked_at: new Date().toISOString() })
      .eq('subscription_id', subscriptionId)
      .neq('status', 'revoked');
    if (error) {
      this.logger.error('Failed to revoke subscription tokens', error);
      throw new InternalServerErrorException('Failed to revoke subscription tokens');
    }
  }

  private async insertRow(
    payload: InsertChallengeInput & { status: PerAuthTokenStatus },
  ): Promise<PerAuthTokenRow> {
    const scopeKind: PerAuthTokenScopeKind = payload.scopeKind ?? 'deployment';
    const subscriptionId = scopeKind === 'subscription' ? payload.subscriptionId ?? null : null;
    if (scopeKind === 'subscription' && !subscriptionId) {
      throw new InternalServerErrorException(
        'subscription-scoped PER token requires subscriptionId',
      );
    }
    const { data, error } = await this.supabaseService.client
      .from('per_auth_tokens')
      .insert({
        token: payload.token,
        deployment_id: payload.deploymentId,
        wallet: payload.wallet,
        group_id: payload.groupId,
        scope_kind: scopeKind,
        subscription_id: subscriptionId,
        status: payload.status,
        expires_at: payload.expiresAt,
        scopes: payload.scopes ?? [],
      })
      .select(COLUMNS)
      .single();
    if (error || !data) {
      this.logger.error('Failed to insert PER auth token', error);
      throw new InternalServerErrorException('Failed to insert PER auth token');
    }
    return data as unknown as PerAuthTokenRow;
  }
}
