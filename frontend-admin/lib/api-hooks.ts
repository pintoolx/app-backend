'use client';

import { useTranslations } from 'next-intl';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { proxyFetch, type ApiError } from './proxy-fetch';
import { toast } from 'sonner';

export interface ApiEnvelope<T> {
  success: boolean;
  data: T;
  count?: number;
}

// ---------------------------------------------------------------- overview ---

export interface AdapterMatrixEntry {
  adapter: 'onchain' | 'er' | 'per' | 'pp' | 'umbra';
  mode: 'real' | 'noop';
  hint: string;
}

export interface AdminOverview {
  generatedAt: string;
  uptimeSeconds: number;
  adapters: AdapterMatrixEntry[];
  counts: {
    users: number;
    accounts: number;
    workflows: number;
    strategies: { total: number; published: number; draft: number };
    deployments: Record<string, number>;
    runningExecutions: number;
    activePerTokens: number;
  };
  recentAdminActions: AuditEntry[];
}

export function useOverview() {
  return useQuery({
    queryKey: ['admin', 'overview'],
    queryFn: () => proxyFetch<ApiEnvelope<AdminOverview>>('/admin/overview'),
    refetchInterval: 30_000,
  });
}

// ---------------------------------------------------------------- users ------

export interface AdminUserListEntry {
  walletAddress: string;
  createdAt: string | null;
  lastActiveAt: string | null;
  accountCount: number;
}

export function useUsers(params: { search?: string; limit?: number } = {}) {
  const search = new URLSearchParams();
  if (params.search) search.set('search', params.search);
  if (params.limit) search.set('limit', String(params.limit));
  const qs = search.toString();
  return useQuery({
    queryKey: ['admin', 'users', params],
    queryFn: () =>
      proxyFetch<ApiEnvelope<AdminUserListEntry[]>>(`/admin/users${qs ? `?${qs}` : ''}`),
    staleTime: 15_000,
  });
}

export interface BannedWalletRow {
  wallet: string;
  reason: string | null;
  banned_by: string | null;
  banned_at: string;
  expires_at: string | null;
}

export function useBannedWallets() {
  return useQuery({
    queryKey: ['admin', 'users', 'banned'],
    queryFn: () => proxyFetch<ApiEnvelope<BannedWalletRow[]>>('/admin/users/banned'),
    staleTime: 30_000,
  });
}

export function useBanWallet() {
  const t = useTranslations('toast');
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      wallet: string;
      reason: string | null;
      expiresAt: string | null;
    }) =>
      proxyFetch(`/admin/users/${encodeURIComponent(input.wallet)}/ban`, {
        method: 'POST',
        body: JSON.stringify({
          confirmTargetId: input.wallet,
          reason: input.reason,
          expiresAt: input.expiresAt,
        }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'users'] });
      toast.success(t('walletBanned'));
    },
    onError: (err: ApiError) => toast.error(err.message),
  });
}

export function useUnbanWallet() {
  const t = useTranslations('toast');
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (wallet: string) =>
      proxyFetch(`/admin/users/${encodeURIComponent(wallet)}/unban`, {
        method: 'POST',
        body: JSON.stringify({ confirmTargetId: wallet }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'users'] });
      toast.success(t('walletUnbanned'));
    },
    onError: (err: ApiError) => toast.error(err.message),
  });
}

// ---------------------------------------------------------------- strategies

export interface StrategyRow {
  id: string;
  creator_wallet_address: string;
  name: string;
  description: string | null;
  visibility_mode: 'public' | 'private';
  lifecycle_state: 'draft' | 'published' | 'archived';
  current_version: number | null;
  created_at: string;
  updated_at: string;
}

export function useStrategies(params: {
  lifecycle?: 'draft' | 'published' | 'archived';
  visibility?: 'public' | 'private';
  creator?: string;
  limit?: number;
} = {}) {
  const search = new URLSearchParams();
  if (params.lifecycle) search.set('lifecycle', params.lifecycle);
  if (params.visibility) search.set('visibility', params.visibility);
  if (params.creator) search.set('creator', params.creator);
  if (params.limit) search.set('limit', String(params.limit));
  const qs = search.toString();
  return useQuery({
    queryKey: ['admin', 'strategies', params],
    queryFn: () =>
      proxyFetch<ApiEnvelope<StrategyRow[]>>(`/admin/strategies${qs ? `?${qs}` : ''}`),
    staleTime: 30_000,
  });
}

// ---------------------------------------------------------------- deployments

export type LifecycleStatus = 'draft' | 'deployed' | 'paused' | 'stopped' | 'closed';

export interface DeploymentRow {
  id: string;
  strategy_id: string;
  creator_wallet_address: string;
  account_id: string | null;
  execution_mode: string;
  treasury_mode: string;
  lifecycle_status: LifecycleStatus;
  state_revision: number | null;
  created_at: string;
  updated_at: string;
}

export function useDeployments(params: {
  status?: LifecycleStatus;
  creator?: string;
  strategyId?: string;
  limit?: number;
} = {}) {
  const search = new URLSearchParams();
  if (params.status) search.set('status', params.status);
  if (params.creator) search.set('creator', params.creator);
  if (params.strategyId) search.set('strategyId', params.strategyId);
  if (params.limit) search.set('limit', String(params.limit));
  const qs = search.toString();
  return useQuery({
    queryKey: ['admin', 'deployments', params],
    queryFn: () =>
      proxyFetch<ApiEnvelope<DeploymentRow[]>>(`/admin/deployments${qs ? `?${qs}` : ''}`),
    staleTime: 15_000,
  });
}

export interface DeploymentRunRow {
  id: string;
  deployment_id: string;
  execution_layer: string;
  status: string;
  started_at: string;
  completed_at: string | null;
  error_message: string | null;
}

export interface DeploymentDetailRow extends DeploymentRow {
  strategy_version_id: string | null;
  private_state_account: string | null;
  public_snapshot_account: string | null;
  er_session_id: string | null;
  per_session_id: string | null;
  umbra_user_account: string | null;
  metadata: Record<string, unknown> | null;
  er_router_url: string | null;
  er_committed_at: string | null;
  umbra_registration_status: 'pending' | 'confirmed' | 'failed' | null;
  per_endpoint_url: string | null;
  pp_endpoint_url: string | null;
  recentRuns: DeploymentRunRow[];
}

export function useDeploymentDetail(id?: string) {
  return useQuery({
    queryKey: ['admin', 'deployments', 'detail', id],
    queryFn: () => proxyFetch<ApiEnvelope<DeploymentDetailRow>>(`/admin/deployments/${id}`),
    enabled: Boolean(id),
    staleTime: 15_000,
  });
}

export function useDeploymentAction(action: 'pause' | 'resume' | 'stop' | 'force-close') {
  const t = useTranslations('toast');
  const tDeployments = useTranslations('deployments');
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string | null }) => {
      const path = `/admin/deployments/${id}/${action}`;
      const body =
        action === 'pause' || action === 'resume'
          ? undefined
          : JSON.stringify({ confirmTargetId: id, reason: reason ?? null });
      return proxyFetch(path, {
        method: 'POST',
        body,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'deployments'] });
      qc.invalidateQueries({ queryKey: ['admin', 'overview'] });
      toast.success(
        action === 'force-close'
          ? t('deploymentForceClosed')
          : t('deploymentActionRequested', {
              action:
                action === 'pause'
                  ? tDeployments('pause')
                  : action === 'resume'
                  ? tDeployments('resume')
                  : tDeployments('stopTitle'),
            }),
      );
    },
    onError: (err: ApiError) => toast.error(err.message),
  });
}

// ---------------------------------------------------------------- privacy ----

export interface AdminPrivacyOverview {
  generatedAt: string;
  adapters: {
    umbra: 'real' | 'noop';
    per: 'real' | 'noop';
    pp: 'real' | 'noop';
    er: 'real' | 'noop';
  };
  perTokens: {
    total: number;
    byStatus: Record<'challenge' | 'active' | 'revoked', number>;
    expiringIn24h: number;
    expiringIn7d: number;
  };
  snapshots: {
    totalLast24h: number;
    totalLast7d: number;
    latestPublishedAt: string | null;
    latestRevision: number | null;
  };
  umbra: {
    configured: boolean;
    seedSource: 'keeper' | 'env' | 'system_config' | null;
    seedFingerprint: string | null;
    registrations: { confirmed: number; pending: number; failed: number; unset: number };
  };
  er: {
    delegatedDeployments: number;
    recentlyCommittedLast24h: number;
  };
  followerVaults: {
    total: number;
    byStatus: Record<
      'pending_funding' | 'active' | 'paused' | 'exiting' | 'closed',
      number
    >;
  };
  subscriptions: {
    total: number;
    byStatus: Record<
      'pending_funding' | 'active' | 'paused' | 'exiting' | 'closed',
      number
    >;
    withUmbraIdentity: number;
  };
  privateCycles: {
    last24h: number;
    last7d: number;
    failedLast24h: number;
    completedLast24h: number;
  };
  visibilityGrants: {
    active: number;
    revoked: number;
    expired: number;
  };
}

export function usePrivacyOverview() {
  return useQuery({
    queryKey: ['admin', 'privacy', 'overview'],
    queryFn: () => proxyFetch<ApiEnvelope<AdminPrivacyOverview>>('/admin/privacy/overview'),
    staleTime: 30_000,
  });
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
    tokens: PerTokenRow[];
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

export function useDeploymentPrivacyView(id?: string) {
  return useQuery({
    queryKey: ['admin', 'privacy', 'deployments', id],
    queryFn: () =>
      proxyFetch<ApiEnvelope<DeploymentPrivacyView>>(`/admin/privacy/deployments/${id}`),
    enabled: Boolean(id),
    staleTime: 15_000,
  });
}

export interface PerTokenRow {
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

export function usePerTokens(params: {
  status?: 'challenge' | 'active' | 'revoked';
  wallet?: string;
  deploymentId?: string;
} = {}) {
  const search = new URLSearchParams();
  if (params.status) search.set('status', params.status);
  if (params.wallet) search.set('wallet', params.wallet);
  if (params.deploymentId) search.set('deploymentId', params.deploymentId);
  const qs = search.toString();
  return useQuery({
    queryKey: ['admin', 'privacy', 'per-tokens', params],
    queryFn: () =>
      proxyFetch<ApiEnvelope<PerTokenRow[]>>(
        `/admin/privacy/per-tokens${qs ? `?${qs}` : ''}`,
      ),
    staleTime: 15_000,
  });
}

export function useRevokePerToken() {
  const t = useTranslations('toast');
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (token: string) =>
      proxyFetch(`/admin/privacy/per-tokens/${encodeURIComponent(token)}/revoke`, {
        method: 'POST',
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'privacy'] });
      toast.success(t('perTokenRevoked'));
    },
    onError: (err: ApiError) => toast.error(err.message),
  });
}

export function useRevokeAllPerTokens() {
  const t = useTranslations('toast');
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (deploymentId: string) =>
      proxyFetch(
        `/admin/privacy/deployments/${encodeURIComponent(deploymentId)}/revoke-all-tokens`,
        { method: 'POST' },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'privacy'] });
      toast.success(t('allPerTokensRevoked'));
    },
    onError: (err: ApiError) => toast.error(err.message),
  });
}

// ---------------------------------------------------------------- executions

export function useKillExecution() {
  const t = useTranslations('toast');
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string | null }) =>
      proxyFetch(`/admin/executions/${id}/kill`, {
        method: 'POST',
        body: JSON.stringify({ reason: reason ?? undefined }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'executions'] });
      qc.invalidateQueries({ queryKey: ['admin', 'overview'] });
      toast.success(t('executionKilled'));
    },
    onError: (err: ApiError) => toast.error(err.message),
  });
}

// ---------------------------------------------------------------- system -----

export function useAdapterMatrix() {
  return useQuery({
    queryKey: ['admin', 'system', 'adapters'],
    queryFn: () => proxyFetch<ApiEnvelope<AdapterMatrixEntry[]>>('/admin/system/adapter-matrix'),
    staleTime: 60_000,
  });
}

export interface ProbeResult {
  status: 'ok' | 'degraded' | 'fail' | 'skipped';
  latencyMs: number;
  note?: string;
}

export interface SystemHealthReport {
  status: string;
  checks: Record<string, ProbeResult>;
}

export function useSystemHealth() {
  return useQuery({
    queryKey: ['admin', 'system', 'health'],
    queryFn: () => proxyFetch<ApiEnvelope<SystemHealthReport>>('/admin/system/health'),
    refetchInterval: 30_000,
  });
}

export interface KeeperStatus {
  publicKey: string | null;
  initialized: boolean;
  balanceSol: number | null;
  warningLevel: 'ok' | 'low' | 'critical' | 'unknown';
}

export function useKeeperStatus() {
  return useQuery({
    queryKey: ['admin', 'system', 'keeper'],
    queryFn: () => proxyFetch<ApiEnvelope<KeeperStatus>>('/admin/system/keeper'),
    refetchInterval: 60_000,
  });
}

export interface MaintenanceState {
  enabled: boolean;
  message: string | null;
  startedAt: string | null;
  startedBy: string | null;
}

export function useMaintenance() {
  return useQuery({
    queryKey: ['admin', 'system', 'maintenance'],
    queryFn: () => proxyFetch<ApiEnvelope<MaintenanceState>>('/admin/system/maintenance'),
    staleTime: 5_000,
  });
}

export function useSetMaintenance() {
  const t = useTranslations('toast');
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { enabled: boolean; message: string | null }) =>
      proxyFetch('/admin/system/maintenance', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'system'] });
      qc.invalidateQueries({ queryKey: ['admin', 'maintenance-banner'] });
      toast.success(t('maintenanceUpdated'));
    },
    onError: (err: ApiError) => toast.error(err.message),
  });
}

// ---------------------------------------------------------------- audit ------

export interface AuditEntry {
  id: string;
  admin_user_id: string | null;
  admin_email: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  ip_address: string | null;
  user_agent: string | null;
  status: 'success' | 'failure';
  payload: Record<string, unknown> | null;
  error_message: string | null;
  created_at: string;
}

export function useAuditLog(params: {
  action?: string;
  targetType?: string;
  targetId?: string;
  status?: 'success' | 'failure';
  from?: string;
  to?: string;
  limit?: number;
} = {}) {
  const search = new URLSearchParams();
  if (params.action) search.set('action', params.action);
  if (params.targetType) search.set('targetType', params.targetType);
  if (params.targetId) search.set('targetId', params.targetId);
  if (params.status) search.set('status', params.status);
  if (params.from) search.set('from', params.from);
  if (params.to) search.set('to', params.to);
  if (params.limit) search.set('limit', String(params.limit));
  const qs = search.toString();
  return useQuery({
    queryKey: ['admin', 'audit', params],
    queryFn: () =>
      proxyFetch<ApiEnvelope<AuditEntry[]>>(`/admin/audit${qs ? `?${qs}` : ''}`),
    staleTime: 10_000,
  });
}

// ---------------------------------------------------------------- follower vaults

export type FollowerVaultLifecycleStatus =
  | 'pending_funding'
  | 'active'
  | 'paused'
  | 'exiting'
  | 'closed';

export type SubscriptionStatus = FollowerVaultLifecycleStatus;

export type PrivateCycleStatus = 'accepted' | 'running' | 'completed' | 'failed';

export type VisibilityGrantStatus = 'active' | 'revoked' | 'expired';

export interface AdminFollowerVaultRow {
  id: string;
  subscription_id: string;
  deployment_id: string;
  vault_pda: string | null;
  authority_pda: string | null;
  lifecycle_status: FollowerVaultLifecycleStatus;
  private_state_ref: string | null;
  public_snapshot_ref: string | null;
  custody_mode: string;
  created_at: string;
  updated_at: string;
}

export interface AdminSubscriptionRow {
  id: string;
  deployment_id: string;
  follower_wallet: string;
  status: SubscriptionStatus;
  visibility_preset: string;
  allocation_mode: string;
  max_capital: string | null;
  max_drawdown_bps: number | null;
  subscription_pda: string | null;
  follower_vault_pda: string | null;
  vault_authority_pda: string | null;
  per_member_ref: string | null;
  umbra_identity_ref: string | null;
  created_at: string;
  updated_at: string;
}

export interface AdminPrivateCycleRow {
  id: string;
  deployment_id: string;
  idempotency_key: string;
  trigger_type: string;
  trigger_ref: string | null;
  status: PrivateCycleStatus;
  metrics_summary: Record<string, unknown>;
  started_at: string;
  completed_at: string | null;
  error_message: string | null;
}

export interface AdminFollowerExecutionReceiptRow {
  id: string;
  cycle_id: string;
  subscription_id: string;
  follower_vault_id: string;
  allocation_amount: string | null;
  allocation_pct_bps: number | null;
  private_state_revision: number | null;
  status: 'planned' | 'applied' | 'skipped' | 'failed';
  payload: Record<string, unknown>;
  created_at: string;
}

export interface AdminPrivateCycleDetail {
  cycle: AdminPrivateCycleRow;
  receipts: AdminFollowerExecutionReceiptRow[];
}

export interface AdminUmbraIdentityRow {
  id: string;
  follower_vault_id: string;
  signer_pubkey: string;
  x25519_public_key: string | null;
  encrypted_user_account: string | null;
  registration_status: 'pending' | 'confirmed' | 'failed' | null;
  register_queue_signature: string | null;
  register_callback_signature: string | null;
  derivation_salt_prefix: string;
  created_at: string;
}

export interface AdminVisibilityGrantRow {
  id: string;
  subscription_id: string;
  grantee_wallet: string;
  scope: string;
  status: VisibilityGrantStatus;
  expires_at: string | null;
  revoked_at: string | null;
  payload: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

const toQs = (params: Record<string, string | number | undefined>): string => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      search.set(key, String(value));
    }
  }
  const qs = search.toString();
  return qs ? `?${qs}` : '';
};

export function useFollowerVaults(
  params: {
    deploymentId?: string;
    status?: FollowerVaultLifecycleStatus;
    limit?: number;
  } = {},
) {
  return useQuery({
    queryKey: ['admin', 'privacy', 'follower-vaults', params],
    queryFn: () =>
      proxyFetch<ApiEnvelope<AdminFollowerVaultRow[]>>(
        `/admin/privacy/follower-vaults${toQs(params)}`,
      ),
    staleTime: 15_000,
  });
}

export function useDeploymentFollowerVaults(
  deploymentId?: string,
  params: { status?: FollowerVaultLifecycleStatus; limit?: number } = {},
) {
  return useQuery({
    queryKey: ['admin', 'privacy', 'deployments', deploymentId, 'follower-vaults', params],
    queryFn: () =>
      proxyFetch<ApiEnvelope<AdminFollowerVaultRow[]>>(
        `/admin/privacy/deployments/${deploymentId}/follower-vaults${toQs(params)}`,
      ),
    enabled: Boolean(deploymentId),
    staleTime: 15_000,
  });
}

export function useSubscriptions(
  params: {
    deploymentId?: string;
    follower?: string;
    status?: SubscriptionStatus;
    limit?: number;
  } = {},
) {
  return useQuery({
    queryKey: ['admin', 'privacy', 'subscriptions', params],
    queryFn: () =>
      proxyFetch<ApiEnvelope<AdminSubscriptionRow[]>>(
        `/admin/privacy/subscriptions${toQs(params)}`,
      ),
    staleTime: 15_000,
  });
}

export function useDeploymentSubscriptions(
  deploymentId?: string,
  params: { status?: SubscriptionStatus; follower?: string; limit?: number } = {},
) {
  return useQuery({
    queryKey: ['admin', 'privacy', 'deployments', deploymentId, 'subscriptions', params],
    queryFn: () =>
      proxyFetch<ApiEnvelope<AdminSubscriptionRow[]>>(
        `/admin/privacy/deployments/${deploymentId}/subscriptions${toQs(params)}`,
      ),
    enabled: Boolean(deploymentId),
    staleTime: 15_000,
  });
}

export function usePrivateExecutionCycles(
  params: {
    deploymentId?: string;
    status?: PrivateCycleStatus;
    since?: string;
    limit?: number;
  } = {},
) {
  return useQuery({
    queryKey: ['admin', 'privacy', 'private-cycles', params],
    queryFn: () =>
      proxyFetch<ApiEnvelope<AdminPrivateCycleRow[]>>(
        `/admin/privacy/private-cycles${toQs(params)}`,
      ),
    staleTime: 15_000,
  });
}

export function useDeploymentPrivateCycles(
  deploymentId?: string,
  params: { status?: PrivateCycleStatus; since?: string; limit?: number } = {},
) {
  return useQuery({
    queryKey: ['admin', 'privacy', 'deployments', deploymentId, 'private-cycles', params],
    queryFn: () =>
      proxyFetch<ApiEnvelope<AdminPrivateCycleRow[]>>(
        `/admin/privacy/deployments/${deploymentId}/private-cycles${toQs(params)}`,
      ),
    enabled: Boolean(deploymentId),
    staleTime: 15_000,
  });
}

export function usePrivateExecutionCycle(cycleId?: string) {
  return useQuery({
    queryKey: ['admin', 'privacy', 'private-cycles', cycleId],
    queryFn: () =>
      proxyFetch<ApiEnvelope<AdminPrivateCycleDetail>>(
        `/admin/privacy/private-cycles/${cycleId}`,
      ),
    enabled: Boolean(cycleId),
    staleTime: 15_000,
  });
}

export function useUmbraIdentityInventory(
  params: {
    deploymentId?: string;
    registrationStatus?: 'pending' | 'confirmed' | 'failed';
    limit?: number;
  } = {},
) {
  return useQuery({
    queryKey: ['admin', 'privacy', 'umbra-identities', params],
    queryFn: () =>
      proxyFetch<ApiEnvelope<AdminUmbraIdentityRow[]>>(
        `/admin/privacy/umbra-identities${toQs(params)}`,
      ),
    staleTime: 30_000,
  });
}

export function useVisibilityGrants(
  params: {
    subscriptionId?: string;
    grantee?: string;
    status?: VisibilityGrantStatus;
    limit?: number;
  } = {},
) {
  return useQuery({
    queryKey: ['admin', 'privacy', 'visibility-grants', params],
    queryFn: () =>
      proxyFetch<ApiEnvelope<AdminVisibilityGrantRow[]>>(
        `/admin/privacy/visibility-grants${toQs(params)}`,
      ),
    staleTime: 15_000,
  });
}
