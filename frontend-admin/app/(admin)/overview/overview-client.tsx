'use client';

import { useLocale, useTranslations } from 'next-intl';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useOverview } from '@/lib/api-hooks';
import { formatDistanceToNow } from 'date-fns';
import { DATE_FNS_LOCALES, normalizeLocale } from '@/i18n/config';
import { Users, Workflow, Boxes, Activity, Lightbulb } from 'lucide-react';

export function OverviewClient() {
  const locale = useLocale();
  const t = useTranslations('overview');
  const tCommon = useTranslations('common');
  const dateLocale = DATE_FNS_LOCALES[normalizeLocale(locale)];
  const { data, isLoading, error } = useOverview();
  if (isLoading) return <p className="text-muted-foreground">{tCommon('loading')}</p>;
  if (error) return <p className="text-destructive">{(error as Error).message}</p>;
  const overview = data?.data;
  if (!overview) return null;

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-1">
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
      </header>

      <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <KPI label={t('users')} value={overview.counts.users} icon={<Users className="h-4 w-4 text-muted-foreground" />} />
        <KPI label={t('strategies')} value={overview.counts.strategies.total} icon={<Workflow className="h-4 w-4 text-muted-foreground" />} />
        <KPI
          label={t('deployments')}
          value={Object.values(overview.counts.deployments).reduce((a, b) => a + b, 0)}
          icon={<Boxes className="h-4 w-4 text-muted-foreground" />}
        />
        <KPI label={t('runningExecutions')} value={overview.counts.runningExecutions} highlight icon={<Activity className="h-4 w-4 text-emerald-500" />} />
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('adapterMatrix')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {overview.adapters.map((a) => (
              <div
                key={a.adapter}
                className="flex flex-col gap-1 rounded-md border bg-card/50 px-3 py-2"
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono text-sm uppercase">{a.adapter}</span>
                  <Badge variant={a.mode === 'real' ? 'success' : 'secondary'}>{a.mode}</Badge>
                </div>
                {a.mode === 'noop' && a.hint ? (
                  <p className="flex items-start gap-1 text-xs text-muted-foreground">
                    <Lightbulb className="mt-0.5 h-3 w-3 shrink-0" />
                    <span>{a.hint}</span>
                  </p>
                ) : null}
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('deploymentStatus')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {Object.entries(overview.counts.deployments).map(([status, count]) => (
              <div key={status} className="flex items-center justify-between text-sm">
                <Badge variant={status === 'deployed' ? 'success' : status === 'paused' ? 'warning' : status === 'stopped' ? 'destructive' : 'secondary'} className="capitalize">
                  {status}
                </Badge>
                <span className="font-mono">{count}</span>
              </div>
            ))}
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
                {overview.recentAdminActions.map((a) => (
                  <li key={a.id} className="flex items-start justify-between gap-3 py-2">
                    <div className="min-w-0">
                      <p className="font-medium">{a.action}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {a.admin_email ?? a.admin_user_id ?? tCommon('unknown')} ·{' '}
                        {a.target_type ? `${a.target_type}:${a.target_id ?? '—'}` : '—'}
                      </p>
                    </div>
                    <Badge variant={a.status === 'success' ? 'success' : 'destructive'}>
                      {a.status}
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
        <span
          className={
            highlight
              ? 'text-3xl font-semibold text-emerald-500'
              : 'text-3xl font-semibold'
          }
        >
          {value.toLocaleString()}
        </span>
      </CardContent>
    </Card>
  );
}
