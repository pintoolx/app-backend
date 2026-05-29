'use client';

import * as React from 'react';
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
  useRuns,
  useRunsHealth,
  type ExecutionLayer,
  type StrategyRunStatus,
} from '@/lib/api-hooks';
import { truncateMiddle } from '@/lib/utils';

const STATUS_VARIANT: Record<string, 'success' | 'warning' | 'secondary' | 'destructive'> = {
  pending: 'warning',
  running: 'warning',
  completed: 'success',
  failed: 'destructive',
  cancelled: 'secondary',
};

export function RunsClient() {
  const t = useTranslations('runs');
  const tCommon = useTranslations('common');
  const [status, setStatus] = React.useState<StrategyRunStatus | undefined>(undefined);
  const [layer, setLayer] = React.useState<ExecutionLayer | undefined>(undefined);
  const [stuckOnly, setStuckOnly] = React.useState(false);

  const health = useRunsHealth();
  const runs = useRuns({ status, executionLayer: layer, stuckOnly, limit: 200 });
  const h = health.data?.data;
  const rows = runs.data?.data ?? [];

  const statusFilters: Array<{ value: StrategyRunStatus | undefined; label: string }> = [
    { value: undefined, label: t('filterAll') },
    { value: 'running', label: t('filterRunning') },
    { value: 'pending', label: t('filterPending') },
    { value: 'completed', label: t('filterCompleted') },
    { value: 'failed', label: t('filterFailed') },
    { value: 'cancelled', label: t('filterCancelled') },
  ];
  const layerFilters: Array<{ value: ExecutionLayer | undefined; label: string }> = [
    { value: undefined, label: t('layerAll') },
    { value: 'offchain', label: 'offchain' },
    { value: 'er', label: 'ER' },
    { value: 'per', label: 'PER' },
  ];

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{t('heading')}</h1>
        <p className="text-sm text-muted-foreground">{t('subheading')}</p>
      </header>

      <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat
          label={t('statSuccessRate')}
          value={`${((h?.successRateBps ?? 0) / 100).toFixed(1)}%`}
          hint={t('statRuns24h', { n: h?.last24h.total ?? 0 })}
        />
        <Stat label={t('statRunning')} value={String(h?.running ?? 0)} />
        <Stat
          label={t('statFailed')}
          value={String(h?.last24h.failed ?? 0)}
          hint={t('statRetryExhausted', { n: h?.retryExhausted24h ?? 0 })}
        />
        <Stat label={t('statStuck')} value={String(h?.stuck ?? 0)} alert={(h?.stuck ?? 0) > 0} />
      </section>

      <div className="flex flex-wrap items-center gap-2">
        {statusFilters.map((f) => (
          <Button
            key={f.label}
            size="sm"
            variant={status === f.value ? 'default' : 'outline'}
            onClick={() => setStatus(f.value)}
          >
            {f.label}
          </Button>
        ))}
        <span className="mx-1 h-5 w-px bg-border" />
        {layerFilters.map((f) => (
          <Button
            key={f.label}
            size="sm"
            variant={layer === f.value ? 'default' : 'outline'}
            onClick={() => setLayer(f.value)}
          >
            {f.label}
          </Button>
        ))}
        <span className="mx-1 h-5 w-px bg-border" />
        <Button
          size="sm"
          variant={stuckOnly ? 'destructive' : 'outline'}
          onClick={() => setStuckOnly((v) => !v)}
        >
          {t('filterStuck')}
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('count', { n: rows.length })}</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('colId')}</TableHead>
                <TableHead>{t('colDeployment')}</TableHead>
                <TableHead>{t('colLayer')}</TableHead>
                <TableHead>{t('colStatus')}</TableHead>
                <TableHead>{t('colStarted')}</TableHead>
                <TableHead>{t('colRetries')}</TableHead>
                <TableHead>{t('colError')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {runs.isLoading ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-6 text-center text-muted-foreground">
                    {tCommon('loading')}
                  </TableCell>
                </TableRow>
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-6 text-center text-muted-foreground">
                    {t('empty')}
                  </TableCell>
                </TableRow>
              ) : null}
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-mono text-xs">{row.id.slice(0, 8)}</TableCell>
                  <TableCell className="font-mono text-xs">
                    {truncateMiddle(row.deployment_id, 6, 4)}
                  </TableCell>
                  <TableCell className="font-mono text-xs uppercase">{row.execution_layer}</TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[row.status] ?? 'secondary'}>{row.status}</Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {format(new Date(row.started_at), 'MM-dd HH:mm')}
                  </TableCell>
                  <TableCell className="text-xs">
                    {row.retry_count}/{row.max_retries}
                    {row.retry_count >= row.max_retries && row.status === 'failed' ? (
                      <Badge variant="destructive" className="ml-1 text-[10px]">
                        {t('retryExhausted')}
                      </Badge>
                    ) : null}
                  </TableCell>
                  <TableCell className="max-w-[240px] truncate text-xs text-destructive" title={row.error_message ?? ''}>
                    {row.error_message ?? '—'}
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

function Stat({
  label,
  value,
  hint,
  alert,
}: {
  label: string;
  value: string;
  hint?: string;
  alert?: boolean;
}) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-1 py-4">
        <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
        <span className={alert ? 'text-2xl font-semibold text-destructive' : 'text-2xl font-semibold'}>
          {value}
        </span>
        {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
      </CardContent>
    </Card>
  );
}
