import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import { SupabaseService } from '../../database/supabase.service';
import { UmbraDeploymentSignerService } from '../../umbra/umbra-deployment-signer.service';
import { KeeperKeypairService } from '../../onchain/keeper-keypair.service';
import { AdminOverviewService } from '../overview/admin-overview.service';

export interface PerTokenSummary {
  total: number;
  byStatus: Record<'challenge' | 'active' | 'revoked', number>;
  expiringIn24h: number;
  expiringIn7d: number;
}

export interface SnapshotFreshness {
  totalLast24h: number;
  totalLast7d: number;
  latestPublishedAt: string | null;
  latestRevision: number | null;
}

export interface UmbraSummary {
  configured: boolean;
  seedSource: 'env' | 'system_config' | null;
  seedFingerprint: string | null;
  registrations: {
    confirmed: number;
    pending: number;
    failed: number;
    unset: number;
  };
}

export interface ErSummary {
  delegatedDeployments: number;
  recentlyCommittedLast24h: number;
}

export interface AdminPrivacyOverview {
  generatedAt: string;
  adapters: {
    umbra: 'real' | 'noop';
    per: 'real' | 'noop';
    pp: 'real' | 'noop';
    er: 'real' | 'noop';
  };
  perTokens: PerTokenSummary;
  snapshots: SnapshotFreshness;
  umbra: UmbraSummary;
  er: ErSummary;
}

export interface PerTokenRowRedacted {
  tokenPrefix: string;
  deploymentId: string;
  wallet: string;
  groupId: string | null;
  status: 'challenge' | 'active' | 'revoked';
  scopes: string[];
  issuedAt: string;
  expiresAt: string;
  revokedAt: string | null;
}

export interface SnapshotRow {
  id: string;
  deploymentId: string;
  snapshotRevision: number;
  status: string;
  pnlSummaryBps: number | null;
  riskBand: string | null;
  publicMetricsHash: string | null;
  publishedSlot: number | null;
  publishedAt: string;
}

export interface DeploymentPrivacyView {
  deploymentId: string;
  lifecycleStatus: string;
  executionMode: string;
  treasuryMode: string;
  onchain: {
    privateStateAccount: string | null;
    publicSnapshotAccount: string | null;
  };
  er: {
    sessionId: string | null;
    routerUrl: string | null;
    committedAt: string | null;
    delegateSignature: string | null;
    undelegateSignature: string | null;
  };
  per: {
    sessionId: string | null;
    endpointUrl: string | null;
    tokens: PerTokenRowRedacted[];
  };
  pp: {
    sessionId: string | null;
    endpointUrl: string | null;
  };
  umbra: {
    userAccount: string | null;
    x25519Pubkey: string | null;
    signerPubkey: string | null;
    registrationStatus: 'pending' | 'confirmed' | 'failed' | null;
    registerQueueSignature: string | null;
    registerCallbackSignature: string | null;
    masterSeedRef: string | null;
  };
  recentSnapshots: SnapshotRow[];
}

export interface KeyMaterialReport {
  generatedAt: string;
  adminTotpEncKey: { present: boolean; source: 'env' | null; fingerprint: string | null };
  umbraMasterSeed: {
    present: boolean;
    source: 'env' | 'system_config' | null;
    fingerprint: string | null;
  };
  adminJwtSecret: { present: boolean; lengthBytes: number };
  keeperKeypair: {
    present: boolean;
    source: 'env' | 'system_config' | null;
    publicKey: string | null;
  };
}

const PER_TOKEN_COLUMNS =
  'token, deployment_id, wallet, group_id, status, scopes, issued_at, expires_at, revoked_at';

const SNAPSHOT_COLUMNS =
  'id, deployment_id, snapshot_revision, status, pnl_summary_bps, risk_band, public_metrics_hash, published_slot, published_at';

@Injectable()
export class AdminPrivacyService {
  private readonly logger = new Logger(AdminPrivacyService.name);

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly configService: ConfigService,
    private readonly overviewService: AdminOverviewService,
    private readonly umbraSigner: UmbraDeploymentSignerService,
    private readonly keeperService: KeeperKeypairService,
  ) {}

  async getOverview(): Promise<AdminPrivacyOverview> {
    const matrix = this.overviewService.computeAdapterMatrix();
    const adapters: AdminPrivacyOverview['adapters'] = {
      umbra: matrix.find((m) => m.adapter === 'umbra')?.mode ?? 'noop',
      per: matrix.find((m) => m.adapter === 'per')?.mode ?? 'noop',
      pp: matrix.find((m) => m.adapter === 'pp')?.mode ?? 'noop',
      er: matrix.find((m) => m.adapter === 'er')?.mode ?? 'noop',
    };

    const [perTokens, snapshots, umbra, er] = await Promise.all([
      this.summarisePerTokens(),
      this.summariseSnapshotFreshness(),
      this.summariseUmbra(),
      this.summariseEr(),
    ]);

    return {
      generatedAt: new Date().toISOString(),
      adapters,
      perTokens,
      snapshots,
      umbra,
      er,
    };
  }

  async listPerTokens(params: {
    status?: 'challenge' | 'active' | 'revoked';
    wallet?: string;
    deploymentId?: string;
    limit?: number;
  }): Promise<PerTokenRowRedacted[]> {
    const limit = Math.min(Math.max(params.limit ?? 100, 1), 500);
    let q = this.supabaseService.client
      .from('per_auth_tokens')
      .select(PER_TOKEN_COLUMNS)
      .order('issued_at', { ascending: false })
      .limit(limit);
    if (params.status) q = q.eq('status', params.status);
    if (params.wallet) q = q.eq('wallet', params.wallet);
    if (params.deploymentId) q = q.eq('deployment_id', params.deploymentId);
    const { data, error } = await q;
    if (error) {
      this.logger.error('Failed to list PER auth tokens (admin)', error);
      return [];
    }
    return (data ?? []).map(toPerTokenRedacted);
  }

  async getDeploymentPrivacyView(deploymentId: string): Promise<DeploymentPrivacyView | null> {
    const { data: row, error } = await this.supabaseService.client
      .from('strategy_deployments')
      .select(
        'id, lifecycle_status, execution_mode, treasury_mode, private_state_account, public_snapshot_account, er_session_id, er_router_url, er_committed_at, er_delegate_signature, er_undelegate_signature, per_session_id, per_endpoint_url, pp_session_id, pp_endpoint_url, umbra_user_account, umbra_x25519_pubkey, umbra_signer_pubkey, umbra_registration_status, umbra_register_queue_signature, umbra_register_callback_signature, umbra_master_seed_ref',
      )
      .eq('id', deploymentId)
      .maybeSingle();
    if (error) {
      this.logger.error('Failed to fetch deployment privacy view', error);
      return null;
    }
    if (!row) return null;

    const [perTokens, snapshots] = await Promise.all([
      this.listPerTokens({ deploymentId, limit: 50 }),
      this.listSnapshots({ deploymentId, limit: 20 }),
    ]);

    return {
      deploymentId: row.id as string,
      lifecycleStatus: row.lifecycle_status as string,
      executionMode: row.execution_mode as string,
      treasuryMode: row.treasury_mode as string,
      onchain: {
        privateStateAccount: (row.private_state_account as string | null) ?? null,
        publicSnapshotAccount: (row.public_snapshot_account as string | null) ?? null,
      },
      er: {
        sessionId: (row.er_session_id as string | null) ?? null,
        routerUrl: (row.er_router_url as string | null) ?? null,
        committedAt: (row.er_committed_at as string | null) ?? null,
        delegateSignature: (row.er_delegate_signature as string | null) ?? null,
        undelegateSignature: (row.er_undelegate_signature as string | null) ?? null,
      },
      per: {
        sessionId: (row.per_session_id as string | null) ?? null,
        endpointUrl: (row.per_endpoint_url as string | null) ?? null,
        tokens: perTokens,
      },
      pp: {
        sessionId: (row.pp_session_id as string | null) ?? null,
        endpointUrl: (row.pp_endpoint_url as string | null) ?? null,
      },
      umbra: {
        userAccount: (row.umbra_user_account as string | null) ?? null,
        x25519Pubkey: (row.umbra_x25519_pubkey as string | null) ?? null,
        signerPubkey: (row.umbra_signer_pubkey as string | null) ?? null,
        registrationStatus:
          (row.umbra_registration_status as 'pending' | 'confirmed' | 'failed' | null) ?? null,
        registerQueueSignature: (row.umbra_register_queue_signature as string | null) ?? null,
        registerCallbackSignature: (row.umbra_register_callback_signature as string | null) ?? null,
        masterSeedRef: (row.umbra_master_seed_ref as string | null) ?? null,
      },
      recentSnapshots: snapshots,
    };
  }

  async listSnapshots(params: {
    deploymentId?: string;
    since?: string;
    limit?: number;
  }): Promise<SnapshotRow[]> {
    const limit = Math.min(Math.max(params.limit ?? 50, 1), 500);
    let q = this.supabaseService.client
      .from('strategy_public_snapshots')
      .select(SNAPSHOT_COLUMNS)
      .order('published_at', { ascending: false })
      .limit(limit);
    if (params.deploymentId) q = q.eq('deployment_id', params.deploymentId);
    if (params.since) q = q.gte('published_at', params.since);
    const { data, error } = await q;
    if (error) {
      this.logger.error('Failed to list public snapshots (admin)', error);
      return [];
    }
    return (data ?? []).map((row: Record<string, unknown>) => ({
      id: row.id as string,
      deploymentId: row.deployment_id as string,
      snapshotRevision: (row.snapshot_revision as number) ?? 0,
      status: (row.status as string) ?? 'unknown',
      pnlSummaryBps: (row.pnl_summary_bps as number) ?? null,
      riskBand: (row.risk_band as string) ?? null,
      publicMetricsHash: (row.public_metrics_hash as string) ?? null,
      publishedSlot: (row.published_slot as number) ?? null,
      publishedAt: row.published_at as string,
    }));
  }

  /**
   * Returns metadata about every secret the admin runtime depends on,
   * without ever exposing the secret material itself. Fingerprints are
   * SHA-256 hashes truncated to 16 hex chars so admins can spot rotation
   * without leaking pre-image. Reserved for the `superadmin` role only —
   * the controller enforces that.
   */
  async getKeyReport(): Promise<KeyMaterialReport> {
    const totpEncKeyHex = this.configService.get<string>('admin.totpEncKey');
    const umbraSeed = this.configService.get<string>('UMBRA_MASTER_SEED');
    const jwtSecret = this.configService.get<string>('admin.jwtSecret');

    const totpFingerprint = totpEncKeyHex
      ? AdminPrivacyService.fingerprint(Buffer.from(totpEncKeyHex, 'hex'))
      : null;

    let umbraResolvedSource: 'env' | 'system_config' | null = null;
    let umbraFingerprint: string | null = null;
    if (this.umbraSigner.isConfigured() || umbraSeed) {
      try {
        const seed = await this.umbraSigner.getMasterSeed();
        umbraFingerprint = AdminPrivacyService.fingerprint(seed);
        umbraResolvedSource = this.umbraSigner.getResolvedSource();
      } catch (err) {
        this.logger.debug(
          `Could not load Umbra master seed for fingerprint: ${err instanceof Error ? err.message : err}`,
        );
      }
    }

    let keeperPublic: string | null = null;
    let keeperSource: 'env' | 'system_config' | null = null;
    try {
      const keypair = await this.keeperService.loadKeypair();
      keeperPublic = keypair.publicKey.toBase58();
      keeperSource = this.keeperService.getResolvedSource();
    } catch (err) {
      this.logger.debug(`Keeper keypair not loaded: ${err instanceof Error ? err.message : err}`);
    }

    return {
      generatedAt: new Date().toISOString(),
      adminTotpEncKey: {
        present: Boolean(totpEncKeyHex),
        source: totpEncKeyHex ? 'env' : null,
        fingerprint: totpFingerprint,
      },
      umbraMasterSeed: {
        present: Boolean(umbraFingerprint),
        source: umbraResolvedSource,
        fingerprint: umbraFingerprint,
      },
      adminJwtSecret: {
        present: Boolean(jwtSecret),
        lengthBytes: jwtSecret ? Buffer.byteLength(jwtSecret, 'utf8') : 0,
      },
      keeperKeypair: {
        present: Boolean(keeperPublic),
        source: keeperSource,
        publicKey: keeperPublic,
      },
    };
  }

  // ---------------------------------------------------------------- helpers

  private async summarisePerTokens(): Promise<PerTokenSummary> {
    const now = new Date();
    const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
    const in7d = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const nowIso = now.toISOString();

    const [active, challenge, revoked, expiring24h, expiring7d] = await Promise.all([
      this.countRows('per_auth_tokens', (q) => q.eq('status', 'active')),
      this.countRows('per_auth_tokens', (q) => q.eq('status', 'challenge')),
      this.countRows('per_auth_tokens', (q) => q.eq('status', 'revoked')),
      this.countRows('per_auth_tokens', (q) =>
        q.eq('status', 'active').lte('expires_at', in24h).gte('expires_at', nowIso),
      ),
      this.countRows('per_auth_tokens', (q) =>
        q.eq('status', 'active').lte('expires_at', in7d).gte('expires_at', nowIso),
      ),
    ]);

    return {
      total: active + challenge + revoked,
      byStatus: { active, challenge, revoked },
      expiringIn24h: expiring24h,
      expiringIn7d: expiring7d,
    };
  }

  private async summariseSnapshotFreshness(): Promise<SnapshotFreshness> {
    const now = Date.now();
    const since24h = new Date(now - 24 * 60 * 60 * 1000).toISOString();
    const since7d = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();

    const [last24h, last7d] = await Promise.all([
      this.countRows('strategy_public_snapshots', (q) => q.gte('published_at', since24h)),
      this.countRows('strategy_public_snapshots', (q) => q.gte('published_at', since7d)),
    ]);

    const { data: latest, error } = await this.supabaseService.client
      .from('strategy_public_snapshots')
      .select('snapshot_revision, published_at')
      .order('published_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      this.logger.warn(`Failed to fetch latest public snapshot: ${error.message}`);
    }

    return {
      totalLast24h: last24h,
      totalLast7d: last7d,
      latestPublishedAt: (latest?.published_at as string | undefined) ?? null,
      latestRevision: (latest?.snapshot_revision as number | undefined) ?? null,
    };
  }

  private async summariseUmbra(): Promise<UmbraSummary> {
    const [confirmed, pending, failed, unset] = await Promise.all([
      this.countRows('strategy_deployments', (q) => q.eq('umbra_registration_status', 'confirmed')),
      this.countRows('strategy_deployments', (q) => q.eq('umbra_registration_status', 'pending')),
      this.countRows('strategy_deployments', (q) => q.eq('umbra_registration_status', 'failed')),
      this.countRows('strategy_deployments', (q) => q.is('umbra_registration_status', null)),
    ]);

    let seedFingerprint: string | null = null;
    let seedSource: 'env' | 'system_config' | null = null;
    if (this.umbraSigner.isConfigured()) {
      try {
        const seed = await this.umbraSigner.getMasterSeed();
        seedFingerprint = AdminPrivacyService.fingerprint(seed);
        seedSource = this.umbraSigner.getResolvedSource();
      } catch {
        // configured by env but unable to load — leave null
      }
    }

    return {
      configured: this.umbraSigner.isConfigured() || seedFingerprint !== null,
      seedSource,
      seedFingerprint,
      registrations: { confirmed, pending, failed, unset },
    };
  }

  private async summariseEr(): Promise<ErSummary> {
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const [delegated, recent] = await Promise.all([
      this.countRows('strategy_deployments', (q) => q.not('er_session_id', 'is', null)),
      this.countRows('strategy_deployments', (q) =>
        q.not('er_committed_at', 'is', null).gte('er_committed_at', since24h),
      ),
    ]);
    return { delegatedDeployments: delegated, recentlyCommittedLast24h: recent };
  }

  private async countRows(
    table: string,
    refine: (q: any) => any, // eslint-disable-line @typescript-eslint/no-explicit-any
  ): Promise<number> {
    const { count, error } = await refine(
      this.supabaseService.client.from(table).select('*', { count: 'exact', head: true }),
    );
    if (error) {
      this.logger.warn(`Failed counting rows in ${table}: ${error.message}`);
      return 0;
    }
    return count ?? 0;
  }

  static fingerprint(buf: Buffer | Uint8Array): string {
    return createHash('sha256').update(buf).digest('hex').slice(0, 16);
  }
}

function toPerTokenRedacted(row: Record<string, unknown>): PerTokenRowRedacted {
  const token = (row.token as string) ?? '';
  return {
    // Show only the first 8 chars so admins can correlate without being able
    // to replay the bearer.
    tokenPrefix: token.length > 8 ? `${token.slice(0, 8)}…` : token,
    deploymentId: (row.deployment_id as string) ?? '',
    wallet: (row.wallet as string) ?? '',
    groupId: (row.group_id as string | null) ?? null,
    status: (row.status as 'challenge' | 'active' | 'revoked') ?? 'revoked',
    scopes: (row.scopes as string[]) ?? [],
    issuedAt: (row.issued_at as string) ?? '',
    expiresAt: (row.expires_at as string) ?? '',
    revokedAt: (row.revoked_at as string | null) ?? null,
  };
}
