'use client';

import { useLocale, useTranslations } from 'next-intl';
import { formatDistanceToNow } from 'date-fns';
import {
  Activity,
  Boxes,
  CheckCircle2,
  Clock3,
  EyeOff,
  KeyRound,
  Lightbulb,
  LockKeyhole,
  ShieldCheck,
  Users,
  Workflow,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { DATE_FNS_LOCALES, normalizeLocale } from '@/i18n/config';
import { useDeployments, useOverview, usePrivacyOverview } from '@/lib/api-hooks';

export function OverviewClient() {
  const locale = useLocale();
  const t = useTranslations('overview');
  const tCommon = useTranslations('common');
  const dateLocale = DATE_FNS_LOCALES[normalizeLocale(locale)];
  const overviewQuery = useOverview();
  const privacyQuery = usePrivacyOverview();
  const deploymentsQuery = useDeployments({ limit: 200 });

  if (overviewQuery.isLoading) {
    return <p className="text-muted-foreground">{tCommon('loading')}</p>;
  }
  if (overviewQuery.error) {
    return <p className="text-destructive">{(overviewQuery.error as Error).message}</p>;
  }

  const overview = overviewQuery.data?.data;
  const privacy = privacyQuery.data?.data;
  const deployments = deploymentsQuery.data?.data ?? [];

  if (!overview) return null;

  const deploymentTotal = Object.values(overview.counts.deployments).reduce((a, b) => a + b, 0);
  const nativeReady = deployments.filter(
    (row) => row.execution_mode === 'per' && row.treasury_mode === 'umbra',
  ).length;
  const partialPrivacy = deployments.filter(
    (row) =>
      (row.execution_mode === 'per' || row.treasury_mode === 'umbra') &&
      !(row.execution_mode === 'per' && row.treasury_mode === 'umbra'),
  ).length;
  const legacySurface = Math.max(deployments.length - nativeReady - partialPrivacy, 0);
  const livePrivacyCoverage = deployments.length
    ? Math.round((nativeReady / deployments.length) * 100)
    : 0;
  const realAdapters = overview.adapters.filter((adapter) => adapter.mode === 'real').length;

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">{t('heading')}</h1>
          <p className="text-sm text-muted-foreground">
            {t('generated', {
              when: formatDistanceToNow(new Date(overview.generatedAt), {
                addSuffix: true,
                locale: dateLocale,
              }),
              minutes: Math.round(overview.uptimeSeconds / 60),
            })}
          </p>
        </div>

        <Card className="overflow-hidden border-0 bg-[linear-gradient(135deg,rgba(7,26,32,1)_0%,rgba(16,54,62,0.98)_52%,rgba(176,90,41,0.92)_100%)] text-white shadow-sm">
          <CardContent className="grid gap-6 p-6 lg:grid-cols-[1.2fr,0.8fr] lg:items-end">
            <div className="space-y-3">
              <Badge variant="outline" className="border-white/20 bg-white/10 text-white">
                {t('nativePostureBadge')}
              </Badge>
              <div className="space-y-2">
                <h2 className="text-2xl font-semibold leading-tight">{t('nativePostureTitle')}</h2>
                <p className="max-w-2xl text-sm leading-6 text-white/75">
                  {t('nativePostureSummary')}
                </p>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
              <HeroStat label={t('heroNativeCoverage')} value={`${livePrivacyCoverage}%`} />
              <HeroStat label={t('heroRealAdapters')} value={`${realAdapters}/5`} />
              <HeroStat
                label={t('heroActiveTokens')}
                value={privacy?.perTokens.byStatus.active.toLocaleString() ?? '—'}
              />
            </div>
          </CardContent>
        </Card>
      </header>

      <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <KPI label={t('users')} value={overview.counts.users} icon={<Users className="h-4 w-4 text-muted-foreground" />} />
        <KPI label={t('strategies')} value={overview.counts.strategies.total} icon={<Workflow className="h-4 w-4 text-muted-foreground" />} />
        <KPI label={t('deployments')} value={deploymentTotal} icon={<Boxes className="h-4 w-4 text-muted-foreground" />} />
        <KPI label={t('runningExecutions')} value={overview.counts.runningExecutions} highlight icon={<Activity className="h-4 w-4 text-emerald-500" />} />
      </section>

      <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <KPI
          label={t('nativeReadyDeployments')}
          value={nativeReady}
          icon={<ShieldCheck className="h-4 w-4 text-emerald-500" />}
        />
        <KPI
          label={t('partialPrivacyDeployments')}
          value={partialPrivacy}
          icon={<LockKeyhole className="h-4 w-4 text-amber-500" />}
        />
        <KPI
          label={t('legacySurfaceDeployments')}
          value={legacySurface}
          icon={<EyeOff className="h-4 w-4 text-muted-foreground" />}
        />
        <KPI
          label={t('activePerTokens')}
          value={privacy?.perTokens.byStatus.active ?? overview.counts.activePerTokens}
          icon={<KeyRound className="h-4 w-4 text-muted-foreground" />}
        />
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.1fr,0.9fr]">
        <Card className="border-border/70 bg-card/80">
          <CardHeader>
            <CardTitle className="text-base">{t('nativeCoverageTitle')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <CoverageRow
              label={t('coverageNative')}
              count={nativeReady}
              total={deployments.length || deploymentTotal}
              tone="success"
            />
            <CoverageRow
              label={t('coveragePartial')}
              count={partialPrivacy}
              total={deployments.length || deploymentTotal}
              tone="warning"
            />
            <CoverageRow
              label={t('coverageLegacy')}
              count={legacySurface}
              total={deployments.length || deploymentTotal}
              tone="secondary"
            />
            <p className="text-xs text-muted-foreground">{t('coverageFootnote')}</p>
          </CardContent>
        </Card>

        <Card className="border-warning/30 bg-warning/5">
          <CardHeader>
            <CardTitle className="text-base">{t('missingPiecesTitle')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <GapRow text={t('missingFollowerVaults')} />
            <GapRow text={t('missingPerRuntime')} />
            <GapRow text={t('missingUmbraIsolation')} />
            <GapRow text={t('missingVisibilityGrants')} />
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 xl:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('privacyHealthTitle')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <StatusRow
              label={t('privacyHealthPerTokens')}
              value={privacy?.perTokens.byStatus.active.toLocaleString() ?? '—'}
            />
            <StatusRow
              label={t('privacyHealthExpiring')}
              value={privacy?.perTokens.expiringIn24h.toLocaleString() ?? '—'}
            />
            <StatusRow
              label={t('privacyHealthUmbraConfirmed')}
              value={privacy?.umbra.registrations.confirmed.toLocaleString() ?? '—'}
            />
            <StatusRow
              label={t('privacyHealthSnapshots')}
              value={privacy?.snapshots.totalLast24h.toLocaleString() ?? '—'}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('adapterMatrix')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {overview.adapters.map((adapter) => (
              <div
                key={adapter.adapter}
                className="flex flex-col gap-1 rounded-md border bg-card/50 px-3 py-2"
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono text-sm uppercase">{adapter.adapter}</span>
                  <Badge variant={adapter.mode === 'real' ? 'success' : 'secondary'}>
                    {adapter.mode}
                  </Badge>
                </div>
                {adapter.mode === 'noop' && adapter.hint ? (
                  <p className="flex items-start gap-1 text-xs text-muted-foreground">
                    <Lightbulb className="mt-0.5 h-3 w-3 shrink-0" />
                    <span>{adapter.hint}</span>
                  </p>
                ) : null}
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('rolloutNextTitle')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <BacklogNote title={t('rolloutItemVaults')} body={t('rolloutItemVaultsBody')} />
            <BacklogNote title={t('rolloutItemSubscriptions')} body={t('rolloutItemSubscriptionsBody')} />
            <BacklogNote title={t('rolloutItemCycles')} body={t('rolloutItemCyclesBody')} />
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('deploymentStatus')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {Object.entries(overview.counts.deployments).map(([status, count]) => (
              <div key={status} className="flex items-center justify-between text-sm">
                <Badge
                  variant={
                    status === 'deployed'
                      ? 'success'
                      : status === 'paused'
                        ? 'warning'
                        : status === 'stopped'
                          ? 'destructive'
                          : 'secondary'
                  }
                  className="capitalize"
                >
                  {status}
                </Badge>
                <span className="font-mono">{count}</span>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('liveSignalsTitle')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <StatusRow label={t('liveSignalsDeployments')} value={deploymentTotal.toLocaleString()} />
            <StatusRow
              label={t('liveSignalsRealAdapters')}
              value={`${realAdapters}/5`}
            />
            <StatusRow
              label={t('liveSignalsNativeCoverage')}
              value={`${livePrivacyCoverage}%`}
            />
            <StatusRow
              label={t('liveSignalsGenerated')}
              value={formatDistanceToNow(new Date(overview.generatedAt), {
                addSuffix: true,
                locale: dateLocale,
              })}
            />
          </CardContent>
        </Card>
      </section>

      <section>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('recentActions')}</CardTitle>
          </CardHeader>
          <CardContent>
            {overview.recentAdminActions.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('noActions')}</p>
            ) : (
              <ul className="divide-y text-sm">
                {overview.recentAdminActions.map((action) => (
                  <li key={action.id} className="flex items-start justify-between gap-3 py-2">
                    <div className="min-w-0">
                      <p className="font-medium">{action.action}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {action.admin_email ?? action.admin_user_id ?? tCommon('unknown')} ·{' '}
                        {action.target_type
                          ? `${action.target_type}:${action.target_id ?? '—'}`
                          : '—'}
                      </p>
                    </div>
                    <Badge variant={action.status === 'success' ? 'success' : 'destructive'}>
                      {action.status}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

function KPI({
  label,
  value,
  highlight,
  icon,
}: {
  label: string;
  value: number;
  highlight?: boolean;
  icon?: React.ReactNode;
}) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-2 py-4">
        <div className="flex items-center gap-2">
          {icon}
          <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
        </div>
        <span className={highlight ? 'text-3xl font-semibold text-emerald-500' : 'text-3xl font-semibold'}>
          {value.toLocaleString()}
        </span>
      </CardContent>
    </Card>
  );
}

function HeroStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-black/15 px-4 py-3 backdrop-blur-sm">
      <p className="text-xs uppercase tracking-[0.18em] text-white/60">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-white">{value}</p>
    </div>
  );
}

function CoverageRow({
  label,
  count,
  total,
  tone,
}: {
  label: string;
  count: number;
  total: number;
  tone: 'success' | 'warning' | 'secondary';
}) {
  const percentage = total > 0 ? Math.round((count / total) * 100) : 0;
  const barClass =
    tone === 'success'
      ? 'bg-emerald-500'
      : tone === 'warning'
        ? 'bg-amber-500'
        : 'bg-slate-400';

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3 text-sm">
        <span>{label}</span>
        <span className="font-mono text-muted-foreground">
          {count}/{total}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-secondary/70">
        <div className={`h-full rounded-full ${barClass}`} style={{ width: `${percentage}%` }} />
      </div>
    </div>
  );
}

function GapRow({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-warning/20 bg-background/70 px-3 py-2">
      <Clock3 className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
      <span>{text}</span>
    </div>
  );
}

function StatusRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-md border bg-card/50 px-3 py-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono text-right text-xs">{value}</span>
    </div>
  );
}

function BacklogNote({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-md border bg-card/50 p-3">
      <div className="flex items-center gap-2">
        <CheckCircle2 className="h-4 w-4 text-emerald-500" />
        <p className="font-medium">{title}</p>
      </div>
      <p className="mt-2 text-muted-foreground">{body}</p>
    </div>
  );
}
