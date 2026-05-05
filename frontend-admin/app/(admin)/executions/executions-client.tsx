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
import { ConfirmDialog } from '@/components/admin/confirm-dialog';
import { useExecutions, useKillExecution, type AdminExecutionRow } from '@/lib/api-hooks';
import { truncateMiddle } from '@/lib/utils';
import type { AdminRole } from '@/lib/auth';

const STATUS_VARIANT: Record<string, 'success' | 'warning' | 'secondary' | 'destructive'> = {
  pending: 'warning',
  running: 'success',
  completed: 'success',
  failed: 'destructive',
  cancelled: 'secondary',
};

export function ExecutionsClient({ role }: { role: AdminRole }) {
  const t = useTranslations('executions');
  const tCommon = useTranslations('common');
  const [statusFilter, setStatusFilter] = React.useState<string | undefined>(undefined);
  const [killTarget, setKillTarget] = React.useState<AdminExecutionRow | null>(null);
  const executions = useExecutions({ status: statusFilter as any, limit: 100 });
  const kill = useKillExecution();
  const isOperator = role === 'operator' || role === 'superadmin';
  const rows = executions.data?.data ?? [];

  const filters: Array<{ value: string | undefined; label: string }> = [
    { value: undefined, label: t('filterAll') },
    { value: 'pending', label: t('filterPending') },
    { value: 'running', label: t('filterRunning') },
    { value: 'completed', label: t('filterCompleted') },
    { value: 'failed', label: t('filterFailed') },
    { value: 'cancelled', label: t('filterCancelled') },
  ];

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{t('heading')}</h1>
        <p className="text-sm text-muted-foreground">{t('subheading')}</p>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        {filters.map((f) => (
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
                <TableHead>{t('workflow')}</TableHead>
                <TableHead>{t('wallet')}</TableHead>
                <TableHead>{t('trigger')}</TableHead>
                <TableHead>{t('status')}</TableHead>
                <TableHead>{t('started')}</TableHead>
                <TableHead>{t('duration')}</TableHead>
                <TableHead className="text-right">{tCommon('actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="py-6 text-center text-muted-foreground">
                    {t('noExecutions')}
                  </TableCell>
                </TableRow>
              ) : null}
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-mono text-xs">{row.id.slice(0, 8)}</TableCell>
                  <TableCell className="font-mono text-xs">{row.workflow_id.slice(0, 8)}</TableCell>
                  <TableCell className="font-mono text-xs">
                    {truncateMiddle(row.owner_wallet_address, 6, 4)}
                  </TableCell>
                  <TableCell className="text-xs">{row.trigger_type ?? '—'}</TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[row.status] ?? 'secondary'}>
                      {row.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {format(new Date(row.started_at), 'MM-dd HH:mm')}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {row.duration_ms != null ? `${row.duration_ms}ms` : '—'}
                  </TableCell>
                  <TableCell className="text-right">
                    {isOperator && (row.status === 'pending' || row.status === 'running') ? (
                      <Button size="sm" variant="destructive" onClick={() => setKillTarget(row)}>
                        {t('kill')}
                      </Button>
                    ) : (
                      '—'
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {killTarget ? (
        <ConfirmDialog
          open
          onOpenChange={() => setKillTarget(null)}
          title={t('killTitle')}
          description={t('killDescription', { id: killTarget.id })}
          confirmTargetId={killTarget.id}
          destructive
          withReason
          confirmLabel={t('kill')}
          loading={kill.isPending}
          onConfirm={async ({ reason }) => {
            await kill.mutateAsync({ id: killTarget.id, reason });
            setKillTarget(null);
          }}
        />
      ) : null}
    </div>
  );
}
