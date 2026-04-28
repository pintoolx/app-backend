'use client';

import * as React from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { format } from 'date-fns';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  useFollowerVaults,
  usePauseFollowerVault,
  usePrivateExecutionCycles,
  useRecoverFollowerVault,
  useRetryPrivateCycle,
  useRevokeVisibilityGrant,
  useSubscriptions,
  useUmbraIdentityInventory,
  useVisibilityGrants,
  type FollowerVaultLifecycleStatus,
  type PrivateCycleStatus,
  type SubscriptionStatus,
  type VisibilityGrantStatus,
} from '@/lib/api-hooks';
import { ConfirmDialog } from '@/components/admin/confirm-dialog';
import type { AdminRole } from '@/lib/auth';
import { truncateMiddle } from '@/lib/utils';

const lifecycleVariant = (
  status: string,
): 'success' | 'warning' | 'secondary' | 'destructive' => {
  switch (status) {
    case 'active':
      return 'success';
    case 'paused':
    case 'pending_funding':
      return 'warning';
    case 'exiting':
    case 'closed':
      return 'secondary';
    default:
      return 'secondary';
  }
};

const cycleStatusVariant = (
  status: string,
): 'success' | 'warning' | 'secondary' | 'destructive' => {
  switch (status) {
    case 'completed':
      return 'success';
    case 'running':
    case 'accepted':
      return 'warning';
    case 'failed':
      return 'destructive';
    default:
      return 'secondary';
  }
};

const grantStatusVariant = (
  status: string,
): 'success' | 'warning' | 'secondary' | 'destructive' => {
  switch (status) {
    case 'active':
      return 'success';
    case 'expired':
      return 'warning';
    case 'revoked':
      return 'secondary';
    default:
      return 'secondary';
  }
};

const registrationVariant = (
  status: string | null,
): 'success' | 'warning' | 'secondary' | 'destructive' => {
  switch (status) {
    case 'confirmed':
      return 'success';
    case 'pending':
      return 'warning';
    case 'failed':
      return 'destructive';
    default:
      return 'secondary';
  }
};

const formatTs = (value: string | null): string =>
  value ? format(new Date(value), 'MM-dd HH:mm') : '—';

interface FilterPillProps<T extends string | undefined> {
  value: T;
  current: T;
  onChange: (value: T) => void;
  children: React.ReactNode;
}

function FilterPill<T extends string | undefined>({
  value,
  current,
  onChange,
  children,
}: FilterPillProps<T>) {
  return (
    <Button
      size="sm"
      variant={current === value ? 'default' : 'outline'}
      onClick={() => onChange(value)}
    >
      {children}
    </Button>
  );
}

// -----------------------------------------------------------------------------
// Follower vaults
// -----------------------------------------------------------------------------

export function FollowerVaultsTab({ role }: { role?: AdminRole } = {}) {
  const t = useTranslations('privacy');
  const [status, setStatus] = React.useState<FollowerVaultLifecycleStatus | undefined>(
    undefined,
  );
  const { data, isLoading } = useFollowerVaults({ status });
  const rows = data?.data ?? [];
  const isOperator = role === 'operator' || role === 'superadmin';
  const pauseMutation = usePauseFollowerVault();
  const recoverMutation = useRecoverFollowerVault();
  const [pauseTarget, setPauseTarget] = React.useState<string | null>(null);
  const [recoverTarget, setRecoverTarget] = React.useState<string | null>(null);

  return (
    <Card>
      <CardHeader className="space-y-2">
        <CardTitle className="text-base">{t('vaultsTitle')}</CardTitle>
        <p className="text-sm text-muted-foreground">{t('vaultsSubtitle')}</p>
        <div className="flex flex-wrap gap-2 pt-2">
          <FilterPill value={undefined} current={status} onChange={setStatus}>
            {t('filterAll')}
          </FilterPill>
          <FilterPill value="active" current={status} onChange={setStatus}>
            {t('filterActive')}
          </FilterPill>
          <FilterPill value="pending_funding" current={status} onChange={setStatus}>
            {t('filterPendingFunding')}
          </FilterPill>
          <FilterPill value="paused" current={status} onChange={setStatus}>
            {t('filterPaused')}
          </FilterPill>
          <FilterPill value="exiting" current={status} onChange={setStatus}>
            {t('filterExiting')}
          </FilterPill>
          <FilterPill value="closed" current={status} onChange={setStatus}>
            {t('filterClosed')}
          </FilterPill>
        </div>
      </CardHeader>
      <CardContent>
        <p className="mb-3 text-xs text-muted-foreground">
          {t('vaultsCount', { n: rows.length })}
        </p>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('colVaultId')}</TableHead>
              <TableHead>{t('deployment')}</TableHead>
              <TableHead>{t('colSubscription')}</TableHead>
              <TableHead>{t('colCustody')}</TableHead>
              <TableHead>{t('colLifecycle')}</TableHead>
              <TableHead>{t('colVaultPda')}</TableHead>
              <TableHead>{t('colCreated')}</TableHead>
              {isOperator ? <TableHead className="text-right" /> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? null : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={isOperator ? 8 : 7} className="py-6 text-center text-muted-foreground">
                  {t('emptyVaults')}
                </TableCell>
              </TableRow>
            ) : null}
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="font-mono text-xs">{row.id.slice(0, 8)}</TableCell>
                <TableCell className="font-mono text-xs">
                  {row.deployment_id.slice(0, 8)}
                </TableCell>
                <TableCell className="font-mono text-xs">
                  {row.subscription_id.slice(0, 8)}
                </TableCell>
                <TableCell className="text-xs">{row.custody_mode}</TableCell>
                <TableCell>
                  <Badge variant={lifecycleVariant(row.lifecycle_status)}>
                    {row.lifecycle_status}
                  </Badge>
                </TableCell>
                <TableCell className="font-mono text-xs">
                  {row.vault_pda ? truncateMiddle(row.vault_pda, 10, 6) : '—'}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {formatTs(row.created_at)}
                </TableCell>
                {isOperator ? (
                  <TableCell className="space-x-2 text-right">
                    {row.lifecycle_status === 'active' ||
                    row.lifecycle_status === 'pending_funding' ? (
                      <Button size="sm" variant="outline" onClick={() => setPauseTarget(row.id)}>
                        {t('actionPauseVault')}
                      </Button>
                    ) : null}
                    {row.lifecycle_status === 'paused' ? (
                      <Button size="sm" variant="outline" onClick={() => setRecoverTarget(row.id)}>
                        {t('actionRecoverVault')}
                      </Button>
                    ) : null}
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
      {pauseTarget ? (
        <ConfirmDialog
          open
          onOpenChange={() => setPauseTarget(null)}
          title={t('confirmPauseVaultTitle')}
          description={t('confirmPauseVaultDescription')}
          confirmTargetId={pauseTarget}
          destructive
          confirmLabel={t('actionPauseVault')}
          loading={pauseMutation.isPending}
          onConfirm={async () => {
            await pauseMutation.mutateAsync(pauseTarget);
            setPauseTarget(null);
          }}
        />
      ) : null}
      {recoverTarget ? (
        <ConfirmDialog
          open
          onOpenChange={() => setRecoverTarget(null)}
          title={t('confirmRecoverVaultTitle')}
          description={t('confirmRecoverVaultDescription')}
          confirmTargetId={recoverTarget}
          confirmLabel={t('actionRecoverVault')}
          loading={recoverMutation.isPending}
          onConfirm={async () => {
            await recoverMutation.mutateAsync(recoverTarget);
            setRecoverTarget(null);
          }}
        />
      ) : null}
    </Card>
  );
}

// -----------------------------------------------------------------------------
// Subscriptions
// -----------------------------------------------------------------------------

export function SubscriptionsTab() {
  const t = useTranslations('privacy');
  const [status, setStatus] = React.useState<SubscriptionStatus | undefined>(undefined);
  const { data, isLoading } = useSubscriptions({ status });
  const rows = data?.data ?? [];

  return (
    <Card>
      <CardHeader className="space-y-2">
        <CardTitle className="text-base">{t('subscriptionsTitle')}</CardTitle>
        <p className="text-sm text-muted-foreground">{t('subscriptionsSubtitle')}</p>
        <div className="flex flex-wrap gap-2 pt-2">
          <FilterPill value={undefined} current={status} onChange={setStatus}>
            {t('filterAll')}
          </FilterPill>
          <FilterPill value="active" current={status} onChange={setStatus}>
            {t('filterActive')}
          </FilterPill>
          <FilterPill value="pending_funding" current={status} onChange={setStatus}>
            {t('filterPendingFunding')}
          </FilterPill>
          <FilterPill value="paused" current={status} onChange={setStatus}>
            {t('filterPaused')}
          </FilterPill>
          <FilterPill value="exiting" current={status} onChange={setStatus}>
            {t('filterExiting')}
          </FilterPill>
          <FilterPill value="closed" current={status} onChange={setStatus}>
            {t('filterClosed')}
          </FilterPill>
        </div>
      </CardHeader>
      <CardContent>
        <p className="mb-3 text-xs text-muted-foreground">
          {t('subscriptionsCount', { n: rows.length })}
        </p>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('colSubscription')}</TableHead>
              <TableHead>{t('deployment')}</TableHead>
              <TableHead>{t('colFollower')}</TableHead>
              <TableHead>{t('colLifecycle')}</TableHead>
              <TableHead>{t('colVisibility')}</TableHead>
              <TableHead>{t('colAllocation')}</TableHead>
              <TableHead>{t('colMaxCapital')}</TableHead>
              <TableHead>{t('colDrawdownBps')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? null : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="py-6 text-center text-muted-foreground">
                  {t('emptySubscriptions')}
                </TableCell>
              </TableRow>
            ) : null}
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="font-mono text-xs">{row.id.slice(0, 8)}</TableCell>
                <TableCell className="font-mono text-xs">
                  {row.deployment_id.slice(0, 8)}
                </TableCell>
                <TableCell className="font-mono text-xs">
                  {truncateMiddle(row.follower_wallet, 6, 4)}
                </TableCell>
                <TableCell>
                  <Badge variant={lifecycleVariant(row.status)}>{row.status}</Badge>
                </TableCell>
                <TableCell className="text-xs">{row.visibility_preset}</TableCell>
                <TableCell className="text-xs">{row.allocation_mode}</TableCell>
                <TableCell className="font-mono text-xs">
                  {row.max_capital ?? '—'}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {row.max_drawdown_bps ?? '—'}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

// -----------------------------------------------------------------------------
// Private execution cycles
// -----------------------------------------------------------------------------

export function PrivateCyclesTab({ role }: { role?: AdminRole } = {}) {
  const t = useTranslations('privacy');
  const [status, setStatus] = React.useState<PrivateCycleStatus | undefined>(undefined);
  const { data, isLoading } = usePrivateExecutionCycles({ status });
  const rows = data?.data ?? [];
  const isOperator = role === 'operator' || role === 'superadmin';
  const retryMutation = useRetryPrivateCycle();
  const [retryTarget, setRetryTarget] = React.useState<string | null>(null);

  return (
    <Card>
      <CardHeader className="space-y-2">
        <CardTitle className="text-base">{t('cyclesTitle')}</CardTitle>
        <p className="text-sm text-muted-foreground">{t('cyclesSubtitle')}</p>
        <div className="flex flex-wrap gap-2 pt-2">
          <FilterPill value={undefined} current={status} onChange={setStatus}>
            {t('filterAll')}
          </FilterPill>
          <FilterPill value="accepted" current={status} onChange={setStatus}>
            {t('filterAccepted')}
          </FilterPill>
          <FilterPill value="running" current={status} onChange={setStatus}>
            {t('filterRunning')}
          </FilterPill>
          <FilterPill value="completed" current={status} onChange={setStatus}>
            {t('filterCompleted')}
          </FilterPill>
          <FilterPill value="failed" current={status} onChange={setStatus}>
            {t('filterFailed')}
          </FilterPill>
        </div>
      </CardHeader>
      <CardContent>
        <p className="mb-3 text-xs text-muted-foreground">
          {t('cyclesCount', { n: rows.length })}
        </p>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('colCycleId')}</TableHead>
              <TableHead>{t('deployment')}</TableHead>
              <TableHead>{t('colTrigger')}</TableHead>
              <TableHead>{t('colLifecycle')}</TableHead>
              <TableHead>{t('colNotional')}</TableHead>
              <TableHead>{t('colReceipts')}</TableHead>
              <TableHead>{t('colStarted')}</TableHead>
              <TableHead>{t('colCompleted')}</TableHead>
              <TableHead className="text-right" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? null : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="py-6 text-center text-muted-foreground">
                  {t('emptyCycles')}
                </TableCell>
              </TableRow>
            ) : null}
            {rows.map((row) => {
              const summary = (row.metrics_summary ?? {}) as Record<string, unknown>;
              const notional = typeof summary.notional === 'string' ? summary.notional : '—';
              const followerCount =
                typeof summary.followerCount === 'number' ? summary.followerCount : '—';
              return (
                <TableRow key={row.id}>
                  <TableCell className="font-mono text-xs">{row.id.slice(0, 8)}</TableCell>
                  <TableCell className="font-mono text-xs">
                    {row.deployment_id.slice(0, 8)}
                  </TableCell>
                  <TableCell className="text-xs">{row.trigger_type}</TableCell>
                  <TableCell>
                    <Badge variant={cycleStatusVariant(row.status)}>{row.status}</Badge>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{notional}</TableCell>
                  <TableCell className="font-mono text-xs">{followerCount}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {formatTs(row.started_at)}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {formatTs(row.completed_at)}
                  </TableCell>
                  <TableCell className="space-x-2 text-right">
                    {isOperator &&
                    (row.status === 'failed' || row.status === 'completed') ? (
                      <Button
                        size="sm"
                        variant={row.status === 'failed' ? 'default' : 'outline'}
                        onClick={() => setRetryTarget(row.id)}
                      >
                        {t('actionRetryCycle')}
                      </Button>
                    ) : null}
                    <Link href={`/privacy/cycles/${row.id}`}>
                      <Button size="sm" variant="outline">
                        {t('viewCycle')}
                      </Button>
                    </Link>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
      {retryTarget ? (
        <ConfirmDialog
          open
          onOpenChange={() => setRetryTarget(null)}
          title={t('confirmRetryCycleTitle')}
          description={t('confirmRetryCycleDescription')}
          confirmTargetId={retryTarget}
          confirmLabel={t('actionRetryCycle')}
          loading={retryMutation.isPending}
          onConfirm={async () => {
            await retryMutation.mutateAsync(retryTarget);
            setRetryTarget(null);
          }}
        />
      ) : null}
    </Card>
  );
}

// -----------------------------------------------------------------------------
// Umbra identities
// -----------------------------------------------------------------------------

export function UmbraIdentitiesTab() {
  const t = useTranslations('privacy');
  const [status, setStatus] = React.useState<
    'pending' | 'confirmed' | 'failed' | undefined
  >(undefined);
  const { data, isLoading } = useUmbraIdentityInventory({
    registrationStatus: status,
  });
  const rows = data?.data ?? [];

  return (
    <Card>
      <CardHeader className="space-y-2">
        <CardTitle className="text-base">{t('identitiesTitle')}</CardTitle>
        <p className="text-sm text-muted-foreground">{t('identitiesSubtitle')}</p>
        <div className="flex flex-wrap gap-2 pt-2">
          <FilterPill value={undefined} current={status} onChange={setStatus}>
            {t('filterAll')}
          </FilterPill>
          <FilterPill value="confirmed" current={status} onChange={setStatus}>
            {t('filterConfirmed')}
          </FilterPill>
          <FilterPill value="pending" current={status} onChange={setStatus}>
            {t('filterPending')}
          </FilterPill>
          <FilterPill value="failed" current={status} onChange={setStatus}>
            {t('filterRegistrationFailed')}
          </FilterPill>
        </div>
      </CardHeader>
      <CardContent>
        <p className="mb-3 text-xs text-muted-foreground">
          {t('identitiesCount', { n: rows.length })}
        </p>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('colVault')}</TableHead>
              <TableHead>{t('colSignerPubkey')}</TableHead>
              <TableHead>{t('colSaltPrefix')}</TableHead>
              <TableHead>{t('colRegistration')}</TableHead>
              <TableHead>{t('colEncryptedAccount')}</TableHead>
              <TableHead>{t('colCreated')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? null : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-6 text-center text-muted-foreground">
                  {t('emptyIdentities')}
                </TableCell>
              </TableRow>
            ) : null}
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="font-mono text-xs">
                  {row.follower_vault_id.slice(0, 8)}
                </TableCell>
                <TableCell className="font-mono text-xs">
                  {truncateMiddle(row.signer_pubkey, 8, 6)}
                </TableCell>
                <TableCell className="font-mono text-xs">
                  {row.derivation_salt_prefix || '—'}
                </TableCell>
                <TableCell>
                  <Badge variant={registrationVariant(row.registration_status)}>
                    {row.registration_status ?? '—'}
                  </Badge>
                </TableCell>
                <TableCell className="font-mono text-xs">
                  {row.encrypted_user_account
                    ? truncateMiddle(row.encrypted_user_account, 8, 6)
                    : '—'}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {formatTs(row.created_at)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

// -----------------------------------------------------------------------------
// Visibility grants
// -----------------------------------------------------------------------------

export function VisibilityGrantsTab({ role }: { role?: AdminRole } = {}) {
  const t = useTranslations('privacy');
  const [status, setStatus] = React.useState<VisibilityGrantStatus | undefined>(undefined);
  const { data, isLoading } = useVisibilityGrants({ status });
  const rows = data?.data ?? [];
  const isOperator = role === 'operator' || role === 'superadmin';
  const revokeMutation = useRevokeVisibilityGrant();
  const [revokeTarget, setRevokeTarget] = React.useState<string | null>(null);

  return (
    <Card>
      <CardHeader className="space-y-2">
        <CardTitle className="text-base">{t('grantsTitle')}</CardTitle>
        <p className="text-sm text-muted-foreground">{t('grantsSubtitle')}</p>
        <div className="flex flex-wrap gap-2 pt-2">
          <FilterPill value={undefined} current={status} onChange={setStatus}>
            {t('filterAll')}
          </FilterPill>
          <FilterPill value="active" current={status} onChange={setStatus}>
            {t('filterActive')}
          </FilterPill>
          <FilterPill value="revoked" current={status} onChange={setStatus}>
            {t('filterRevoked')}
          </FilterPill>
          <FilterPill value="expired" current={status} onChange={setStatus}>
            {t('filterExpired')}
          </FilterPill>
        </div>
      </CardHeader>
      <CardContent>
        <p className="mb-3 text-xs text-muted-foreground">
          {t('grantsCount', { n: rows.length })}
        </p>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('colSubscription')}</TableHead>
              <TableHead>{t('colGrantee')}</TableHead>
              <TableHead>{t('colScope')}</TableHead>
              <TableHead>{t('colLifecycle')}</TableHead>
              <TableHead>{t('colExpires')}</TableHead>
              <TableHead>{t('colCreated')}</TableHead>
              {isOperator ? <TableHead className="text-right" /> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? null : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={isOperator ? 7 : 6} className="py-6 text-center text-muted-foreground">
                  {t('emptyGrants')}
                </TableCell>
              </TableRow>
            ) : null}
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="font-mono text-xs">
                  {row.subscription_id.slice(0, 8)}
                </TableCell>
                <TableCell className="font-mono text-xs">
                  {truncateMiddle(row.grantee_wallet, 6, 4)}
                </TableCell>
                <TableCell className="text-xs">{row.scope}</TableCell>
                <TableCell>
                  <Badge variant={grantStatusVariant(row.status)}>{row.status}</Badge>
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {formatTs(row.expires_at)}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {formatTs(row.created_at)}
                </TableCell>
                {isOperator ? (
                  <TableCell className="text-right">
                    {row.status === 'active' ? (
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => setRevokeTarget(row.id)}
                      >
                        {t('actionRevokeGrant')}
                      </Button>
                    ) : null}
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
      {revokeTarget ? (
        <ConfirmDialog
          open
          onOpenChange={() => setRevokeTarget(null)}
          title={t('confirmRevokeGrantTitle')}
          description={t('confirmRevokeGrantDescription')}
          confirmTargetId={revokeTarget}
          destructive
          confirmLabel={t('actionRevokeGrant')}
          loading={revokeMutation.isPending}
          onConfirm={async () => {
            await revokeMutation.mutateAsync(revokeTarget);
            setRevokeTarget(null);
          }}
        />
      ) : null}
    </Card>
  );
}
