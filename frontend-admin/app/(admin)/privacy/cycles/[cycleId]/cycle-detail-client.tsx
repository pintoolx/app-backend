'use client';

import * as React from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { format } from 'date-fns';
import { ArrowLeft } from 'lucide-react';
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
import { usePrivateExecutionCycle } from '@/lib/api-hooks';
import { truncateMiddle } from '@/lib/utils';

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

const receiptStatusVariant = (
  status: string,
): 'success' | 'warning' | 'secondary' | 'destructive' => {
  switch (status) {
    case 'applied':
      return 'success';
    case 'planned':
      return 'warning';
    case 'failed':
      return 'destructive';
    default:
      return 'secondary';
  }
};

const formatTs = (value: string | null): string =>
  value ? format(new Date(value), 'yyyy-MM-dd HH:mm') : '—';

export function CycleDetailClient({ cycleId }: { cycleId: string }) {
  const t = useTranslations('privacy');
  const tCommon = useTranslations('common');
  const { data, isLoading, error } = usePrivateExecutionCycle(cycleId);

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-3">
        <div className="space-y-2">
          <Link href="/privacy">
            <Button size="sm" variant="ghost" className="gap-2">
              <ArrowLeft className="h-4 w-4" />
              {t('backToCycles')}
            </Button>
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight">{t('cycleDetailHeading')}</h1>
          <p className="text-sm text-muted-foreground">{t('cycleDetailSubheading')}</p>
          <p className="font-mono text-xs text-muted-foreground">{cycleId}</p>
        </div>
      </header>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">{tCommon('loading')}</p>
      ) : error ? (
        <p className="text-sm text-destructive">{t('cycleDetailNotFound')}</p>
      ) : data?.data ? (
        <CycleBody detail={data.data} />
      ) : (
        <p className="text-sm text-muted-foreground">{t('cycleDetailNotFound')}</p>
      )}
    </div>
  );
}

function CycleBody({ detail }: { detail: NonNullable<ReturnType<typeof usePrivateExecutionCycle>['data']>['data'] }) {
  const t = useTranslations('privacy');
  const { cycle, receipts } = detail;
  const summary = (cycle.metrics_summary ?? {}) as Record<string, unknown>;
  const notional = typeof summary.notional === 'string' ? summary.notional : '—';
  const followerCount =
    typeof summary.followerCount === 'number' ? summary.followerCount : '—';
  const totalAllocated =
    typeof summary.totalAllocated === 'string' ? summary.totalAllocated : '—';

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <KPI label={t('colLifecycle')}>
          <Badge variant={cycleStatusVariant(cycle.status)}>{cycle.status}</Badge>
        </KPI>
        <KPI label={t('colTrigger')}>
          <span className="text-sm">{cycle.trigger_type}</span>
        </KPI>
        <KPI label={t('colNotional')}>
          <span className="font-mono text-sm">{notional}</span>
        </KPI>
        <KPI label={t('colReceipts')}>
          <span className="font-mono text-sm">{followerCount}</span>
        </KPI>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('cycleDetailMetricsTitle')}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm md:grid-cols-2">
          <Row label={t('deployment')} value={cycle.deployment_id} mono />
          <Row label={t('colCycleId')} value={cycle.id} mono />
          <Row label={t('colTrigger')} value={cycle.trigger_type} />
          <Row label={t('colStarted')} value={formatTs(cycle.started_at)} />
          <Row label={t('colCompleted')} value={formatTs(cycle.completed_at)} />
          <Row label={t('colNotional')} value={notional} mono />
          <Row label={t('colReceipts')} value={String(followerCount)} mono />
          <Row label={t('colAllocAmount')} value={totalAllocated} mono />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('cycleDetailReceiptsTitle')}</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('colSubscription')}</TableHead>
                <TableHead>{t('colVault')}</TableHead>
                <TableHead>{t('colReceiptStatus')}</TableHead>
                <TableHead>{t('colAllocAmount')}</TableHead>
                <TableHead>{t('colAllocBps')}</TableHead>
                <TableHead>{t('colReceiptCreated')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {receipts.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-6 text-center text-muted-foreground">
                    {t('cycleDetailNoReceipts')}
                  </TableCell>
                </TableRow>
              ) : null}
              {receipts.map((receipt) => (
                <TableRow key={receipt.id}>
                  <TableCell className="font-mono text-xs">
                    {truncateMiddle(receipt.subscription_id, 6, 4)}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {truncateMiddle(receipt.follower_vault_id, 6, 4)}
                  </TableCell>
                  <TableCell>
                    <Badge variant={receiptStatusVariant(receipt.status)}>
                      {receipt.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {receipt.allocation_amount ?? '—'}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {receipt.allocation_pct_bps ?? '—'}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {formatTs(receipt.created_at)}
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

function KPI({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-2 py-4">
        <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
        <div>{children}</div>
      </CardContent>
    </Card>
  );
}

function Row({
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
