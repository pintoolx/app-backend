'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { format } from 'date-fns';
import { MoreHorizontal, Server, ShieldCheck } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ConfirmDialog } from '@/components/admin/confirm-dialog';
import Link from 'next/link';
import {
  useDeploymentAction,
  useDeploymentDetail,
  useDeploymentFollowerVaults,
  useDeploymentPrivacyView,
  useDeploymentPrivateCycles,
  useDeploymentSubscriptions,
  useDeployments,
  type DeploymentDetailRow,
  type DeploymentPrivacyView,
  type DeploymentRow,
  type LifecycleStatus,
} from '@/lib/api-hooks';
import { truncateMiddle } from '@/lib/utils';
import type { AdminRole } from '@/lib/auth';

const STATUS_VARIANT: Record<LifecycleStatus, 'success' | 'warning' | 'secondary' | 'destructive'> = {
  deployed: 'success',
  paused: 'warning',
  stopped: 'secondary',
  closed: 'secondary',
  draft: 'secondary',
};

interface DialogState {
  kind: 'pause' | 'resume' | 'stop' | 'force-close' | 'collect-fees';
  deployment: DeploymentRow;
}

export function DeploymentsClient({ role }: { role: AdminRole }) {
  const t = useTranslations('deployments');
  const tCommon = useTranslations('common');
  const tA11y = useTranslations('a11y');
  const [statusFilter, setStatusFilter] = React.useState<LifecycleStatus | undefined>(undefined);
  const [dialog, setDialog] = React.useState<DialogState | null>(null);
  const [detailDeployment, setDetailDeployment] = React.useState<DeploymentRow | null>(null);

  const statusFilters: Array<{ value: LifecycleStatus | undefined; label: string }> = [
    { value: undefined, label: t('filterAll') },
    { value: 'deployed', label: t('filterDeployed') },
    { value: 'paused', label: t('filterPaused') },
    { value: 'stopped', label: t('filterStopped') },
    { value: 'closed', label: t('filterClosed') },
    { value: 'draft', label: t('filterDraft') },
  ];

  const { data } = useDeployments({ status: statusFilter });
  const pause = useDeploymentAction('pause');
  const resume = useDeploymentAction('resume');
  const stop = useDeploymentAction('stop');
  const forceClose = useDeploymentAction('force-close');
  const emergencyPause = useDeploymentAction('emergency-pause');
  const emergencyResume = useDeploymentAction('emergency-resume');
  const collectFees = useDeploymentAction('collect-fees');
  const detail = useDeploymentDetail(detailDeployment?.id);
  const privacyDetail = useDeploymentPrivacyView(detailDeployment?.id);

  const isOperator = role === 'operator' || role === 'superadmin';
  const isSuper = role === 'superadmin';
  const rows = data?.data ?? [];
  const perCount = rows.filter((row) => row.execution_mode === 'per').length;
  const umbraCount = rows.filter((row) => row.treasury_mode === 'umbra').length;
  const nativeCount = rows.filter(
    (row) => row.execution_mode === 'per' && row.treasury_mode === 'umbra',
  ).length;
  const legacyCount = rows.length - nativeCount;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{t('heading')}</h1>
        <p className="text-sm text-muted-foreground">{t('subheading')}</p>
      </header>

      <section className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <KPI
          label={t('kpiPerTitle')}
          value={perCount}
          icon={<Server className="h-4 w-4 text-muted-foreground" />}
        />
        <KPI
          label={t('kpiUmbraTitle')}
          value={umbraCount}
          icon={<ShieldCheck className="h-4 w-4 text-muted-foreground" />}
        />
        <KPI label={t('kpiNativeTitle')} value={nativeCount} highlight />
        <KPI label={t('kpiLegacyTitle')} value={legacyCount} />
      </section>

      <div className="flex flex-wrap items-center gap-2">
        {statusFilters.map((f) => (
          <Button
            key={f.label}
            size="sm"
            variant={statusFilter === f.value ? 'default' : 'outline'}
            onClick={() => setStatusFilter(f.value)}
          >
            {f.label}
          </Button>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('count', { n: rows.length })}</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('id')}</TableHead>
                <TableHead>{t('strategy')}</TableHead>
                <TableHead>{t('creator')}</TableHead>
                <TableHead>{t('mode')}</TableHead>
                <TableHead>{t('status')}</TableHead>
                <TableHead>{t('updated')}</TableHead>
                <TableHead className="w-12 text-right">{tCommon('actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-6 text-center text-muted-foreground">
                    {t('noDeployments')}
                  </TableCell>
                </TableRow>
              ) : null}
              {rows.map((d) => (
                <TableRow key={d.id}>
                  <TableCell className="font-mono text-xs">{d.id.slice(0, 8)}</TableCell>
                  <TableCell className="font-mono text-xs">{d.strategy_id.slice(0, 8)}</TableCell>
                  <TableCell className="font-mono text-xs">
                    {truncateMiddle(d.creator_wallet_address, 6, 4)}
                  </TableCell>
                  <TableCell className="text-xs">
                    <div className="space-y-1">
                      <div>
                        <span className="text-muted-foreground">{d.execution_mode}</span> /{' '}
                        {d.treasury_mode}
                      </div>
                      <Badge variant={privacyPostureVariant(d)}>{privacyPostureLabel(t, d)}</Badge>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[d.lifecycle_status]}>
                      {d.lifecycle_status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {format(new Date(d.updated_at), 'yyyy-MM-dd HH:mm')}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setDetailDeployment(d)}
                      >
                        {t('privacyDetail')}
                      </Button>
                      {isOperator ? (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={tA11y('deploymentActions', { id: d.id.slice(0, 8) })}
                            >
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuLabel>{tCommon('actions')}</DropdownMenuLabel>
                            <DropdownMenuItem
                              onClick={() => pause.mutate({ id: d.id })}
                              disabled={d.lifecycle_status !== 'deployed'}
                            >
                              {t('pause')}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => resume.mutate({ id: d.id })}
                              disabled={d.lifecycle_status !== 'paused'}
                            >
                              {t('resume')}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => setDialog({ kind: 'stop', deployment: d })}
                              disabled={d.lifecycle_status === 'closed'}
                            >
                              {t('stop')}
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onClick={() => emergencyPause.mutate({ id: d.id })}
                              disabled={d.lifecycle_status !== 'deployed'}
                            >
                              {t('emergencyPause')}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => emergencyResume.mutate({ id: d.id })}
                              disabled={d.lifecycle_status !== 'paused'}
                            >
                              {t('emergencyResume')}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => setDialog({ kind: 'collect-fees', deployment: d })}
                            >
                              {t('collectFees')}
                            </DropdownMenuItem>
                            {isSuper ? (
                              <>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  className="text-destructive focus:text-destructive"
                                  onClick={() =>
                                    setDialog({ kind: 'force-close', deployment: d })
                                  }
                                  disabled={d.lifecycle_status === 'closed'}
                                >
                                  {t('forceClose')}
                                </DropdownMenuItem>
                              </>
                            ) : null}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {dialog ? (
        <ConfirmDialog
          open
          onOpenChange={() => setDialog(null)}
          title={
            dialog.kind === 'force-close'
              ? t('forceCloseTitle')
              : dialog.kind === 'stop'
              ? t('stopTitle')
              : dialog.kind === 'collect-fees'
              ? t('collectFeesTitle')
              : tCommon('confirm')
          }
          description={t('confirmDescription', { id: dialog.deployment.id })}
          confirmTargetId={dialog.deployment.id}
          withReason={dialog.kind === 'force-close'}
          destructive={dialog.kind === 'force-close'}
          confirmLabel={
            dialog.kind === 'force-close'
              ? t('forceCloseTitle')
              : dialog.kind === 'collect-fees'
              ? t('collectFeesTitle')
              : t('stopTitle')
          }
          loading={stop.isPending || forceClose.isPending || collectFees.isPending}
          onConfirm={async ({ reason }) => {
            if (dialog.kind === 'force-close') {
              await forceClose.mutateAsync({ id: dialog.deployment.id, reason });
            } else if (dialog.kind === 'stop') {
              await stop.mutateAsync({ id: dialog.deployment.id });
            } else if (dialog.kind === 'collect-fees') {
              await collectFees.mutateAsync({ id: dialog.deployment.id });
            }
            setDialog(null);
          }}
        />
      ) : null}

      <Dialog open={Boolean(detailDeployment)} onOpenChange={(open) => !open && setDetailDeployment(null)}>
        <DialogContent className="max-h-[88vh] max-w-5xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {t('detailTitle', { id: detailDeployment?.id.slice(0, 8) ?? '—' })}
            </DialogTitle>
            <DialogDescription>{t('detailDescription')}</DialogDescription>
          </DialogHeader>

          {detail.isLoading || privacyDetail.isLoading ? (
            <p className="text-sm text-muted-foreground">{tCommon('loading')}</p>
          ) : detail.error || privacyDetail.error ? (
            <p className="text-sm text-destructive">
              {getErrorMessage(detail.error ?? privacyDetail.error)}
            </p>
          ) : detail.data?.data && privacyDetail.data?.data ? (
            <DeploymentPrivacyDialogBody
              t={t}
              deployment={detail.data.data}
              privacy={privacyDetail.data.data}
              deploymentId={detailDeployment?.id}
            />
          ) : (
            <p className="text-sm text-muted-foreground">{t('detailEmpty')}</p>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function DeploymentPrivacyDialogBody({
  t,
  deployment,
  privacy,
  deploymentId,
}: {
  t: (key: string, values?: Record<string, string | number>) => string;
  deployment: DeploymentDetailRow;
  privacy: DeploymentPrivacyView;
  deploymentId?: string;
}) {

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <KPI label={t('detailLifecycle')} value={privacy.lifecycleStatus} compact />
        <KPI
          label={t('detailModes')}
          value={`${privacy.executionMode} / ${privacy.treasuryMode}`}
          compact
        />
        <KPI label={t('detailPerTokens')} value={String(privacy.per.tokens.length)} compact />
        <KPI label={t('detailRuns')} value={String(deployment.recentRuns.length)} compact />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.2fr,0.8fr]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('detailCurrentStateTitle')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <StatusRow label={t('detailStrategyVersion')} value={deployment.strategy_version_id ?? '—'} mono />
            <StatusRow label={t('detailAccount')} value={deployment.account_id ?? '—'} mono />
            <StatusRow label={t('detailPrivateAccount')} value={privacy.onchain.privateStateAccount ?? '—'} mono />
            <StatusRow label={t('detailSnapshotAccount')} value={privacy.onchain.publicSnapshotAccount ?? '—'} mono />
            <StatusRow label={t('detailUpdatedAt')} value={format(new Date(deployment.updated_at), 'yyyy-MM-dd HH:mm')} />
          </CardContent>
        </Card>

        <Card className="border-warning/30 bg-warning/5">
          <CardHeader>
            <CardTitle className="text-base">{t('detailGapTitle')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <p>{t('detailGapIntro')}</p>
            <GapPill text={t('detailGapIdentity')} />
            <GapPill text={t('detailGapRuntime')} />
            <GapPill text={t('detailGapVaults')} />
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('detailPerSection')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <StatusRow label={t('detailSession')} value={privacy.per.sessionId ?? '—'} mono />
            <StatusRow label={t('detailEndpoint')} value={privacy.per.endpointUrl ?? '—'} mono />
            <StatusRow label={t('detailGroupTokens')} value={String(privacy.per.tokens.length)} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('detailUmbraSection')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <StatusRow label={t('detailRegistration')} value={privacy.umbra.registrationStatus ?? '—'} />
            <StatusRow label={t('detailUserAccount')} value={privacy.umbra.userAccount ?? '—'} mono />
            <StatusRow label={t('detailX25519')} value={privacy.umbra.x25519Pubkey ?? '—'} mono />
            <StatusRow label={t('detailSeedRef')} value={privacy.umbra.masterSeedRef ?? '—'} mono />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('detailErSection')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <StatusRow label={t('detailSession')} value={privacy.er.sessionId ?? '—'} mono />
            <StatusRow label={t('detailRouter')} value={privacy.er.routerUrl ?? '—'} mono />
            <StatusRow label={t('detailCommitted')} value={privacy.er.committedAt ?? '—'} mono />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('detailRunsTitle')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {deployment.recentRuns.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('detailNoRuns')}</p>
          ) : (
            deployment.recentRuns.map((run) => (
              <div key={run.id} className="rounded-md border bg-card/50 p-3 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-medium">{run.execution_layer}</p>
                    <p className="font-mono text-xs text-muted-foreground">{run.id}</p>
                  </div>
                  <Badge
                    variant={
                      run.status === 'completed'
                        ? 'success'
                        : run.status === 'failed'
                          ? 'destructive'
                          : 'secondary'
                    }
                  >
                    {run.status}
                  </Badge>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  {format(new Date(run.started_at), 'yyyy-MM-dd HH:mm')}
                </p>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {deploymentId ? <DeploymentFollowerVaultsSection deploymentId={deploymentId} /> : null}
    </div>
  );
}

function DeploymentFollowerVaultsSection({ deploymentId }: { deploymentId: string }) {
  const t = useTranslations('deployments');
  const subscriptions = useDeploymentSubscriptions(deploymentId, { limit: 25 });
  const vaults = useDeploymentFollowerVaults(deploymentId, { limit: 25 });
  const cycles = useDeploymentPrivateCycles(deploymentId, { limit: 10 });

  const subRows = subscriptions.data?.data ?? [];
  const vaultRows = vaults.data?.data ?? [];
  const cycleRows = cycles.data?.data ?? [];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('detailSubscriptionsTitle')}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-xs text-muted-foreground">
            {t('detailSubscriptionsCount', { n: subRows.length })}
          </p>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ID</TableHead>
                <TableHead>Follower</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Visibility</TableHead>
                <TableHead>Allocation</TableHead>
                <TableHead>Max capital</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {subRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-6 text-center text-muted-foreground">
                    {t('detailNoSubscriptions')}
                  </TableCell>
                </TableRow>
              ) : null}
              {subRows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-mono text-xs">{row.id.slice(0, 8)}</TableCell>
                  <TableCell className="font-mono text-xs">
                    {truncateMiddle(row.follower_wallet, 6, 4)}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        row.status === 'active'
                          ? 'success'
                          : row.status === 'pending_funding' || row.status === 'paused'
                            ? 'warning'
                            : 'secondary'
                      }
                    >
                      {row.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs">{row.visibility_preset}</TableCell>
                  <TableCell className="text-xs">{row.allocation_mode}</TableCell>
                  <TableCell className="font-mono text-xs">{row.max_capital ?? '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('detailFollowerVaultsTitle')}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-xs text-muted-foreground">
            {t('detailFollowerVaultsCount', { n: vaultRows.length })}
          </p>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Vault</TableHead>
                <TableHead>Subscription</TableHead>
                <TableHead>Custody</TableHead>
                <TableHead>Lifecycle</TableHead>
                <TableHead>Vault PDA</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {vaultRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-6 text-center text-muted-foreground">
                    {t('detailNoFollowerVaults')}
                  </TableCell>
                </TableRow>
              ) : null}
              {vaultRows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-mono text-xs">{row.id.slice(0, 8)}</TableCell>
                  <TableCell className="font-mono text-xs">
                    {row.subscription_id.slice(0, 8)}
                  </TableCell>
                  <TableCell className="text-xs">{row.custody_mode}</TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        row.lifecycle_status === 'active'
                          ? 'success'
                          : row.lifecycle_status === 'pending_funding' ||
                              row.lifecycle_status === 'paused'
                            ? 'warning'
                            : 'secondary'
                      }
                    >
                      {row.lifecycle_status}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {row.vault_pda ? truncateMiddle(row.vault_pda, 10, 6) : '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('detailPrivateCyclesTitle')}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-xs text-muted-foreground">
            {t('detailPrivateCyclesCount', { n: cycleRows.length })}
          </p>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Cycle</TableHead>
                <TableHead>Trigger</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Started</TableHead>
                <TableHead className="text-right" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {cycleRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-6 text-center text-muted-foreground">
                    {t('detailNoPrivateCycles')}
                  </TableCell>
                </TableRow>
              ) : null}
              {cycleRows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-mono text-xs">{row.id.slice(0, 8)}</TableCell>
                  <TableCell className="text-xs">{row.trigger_type}</TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        row.status === 'completed'
                          ? 'success'
                          : row.status === 'failed'
                            ? 'destructive'
                            : 'warning'
                      }
                    >
                      {row.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {format(new Date(row.started_at), 'MM-dd HH:mm')}
                  </TableCell>
                  <TableCell className="text-right">
                    <Link href={`/privacy/cycles/${row.id}`}>
                      <Button size="sm" variant="outline">
                        Open
                      </Button>
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function KPI({
  label,
  value,
  icon,
  highlight,
  compact,
}: {
  label: string;
  value: number | string;
  icon?: React.ReactNode;
  highlight?: boolean;
  compact?: boolean;
}) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-2 py-4">
        <div className="flex items-center gap-2">
          {icon}
          <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
        </div>
        <span
          className={
            highlight
              ? 'text-3xl font-semibold text-emerald-500'
              : compact
                ? 'text-lg font-semibold'
                : 'text-3xl font-semibold'
          }
        >
          {typeof value === 'number' ? value.toLocaleString() : value}
        </span>
      </CardContent>
    </Card>
  );
}

function StatusRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-md border bg-card/50 px-3 py-2">
      <span className="text-muted-foreground">{label}</span>
      <span className={mono ? 'font-mono text-right text-xs' : 'text-right'}>{value}</span>
    </div>
  );
}

function GapPill({ text }: { text: string }) {
  return (
    <div className="rounded-md border border-warning/20 bg-background/70 px-3 py-2 text-sm">
      {text}
    </div>
  );
}

function privacyPostureLabel(
  t: (key: string, values?: Record<string, string | number>) => string,
  row: DeploymentRow,
) {
  if (row.execution_mode === 'per' && row.treasury_mode === 'umbra') {
    return t('postureNative');
  }
  if (row.execution_mode === 'per' || row.treasury_mode === 'umbra') {
    return t('posturePartial');
  }
  return t('postureLegacy');
}

function privacyPostureVariant(row: DeploymentRow): 'success' | 'warning' | 'secondary' {
  if (row.execution_mode === 'per' && row.treasury_mode === 'umbra') {
    return 'success';
  }
  if (row.execution_mode === 'per' || row.treasury_mode === 'umbra') {
    return 'warning';
  }
  return 'secondary';
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
