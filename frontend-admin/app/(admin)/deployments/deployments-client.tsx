'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
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
import {
  useDeploymentAction,
  useDeployments,
  type DeploymentRow,
  type LifecycleStatus,
} from '@/lib/api-hooks';
import { truncateMiddle } from '@/lib/utils';
import { format } from 'date-fns';
import { MoreHorizontal } from 'lucide-react';
import type { AdminRole } from '@/lib/auth';

const STATUS_VARIANT: Record<LifecycleStatus, 'success' | 'warning' | 'secondary' | 'destructive'> = {
  deployed: 'success',
  paused: 'warning',
  stopped: 'secondary',
  closed: 'secondary',
  draft: 'secondary',
};

interface DialogState {
  kind: 'pause' | 'resume' | 'stop' | 'force-close';
  deployment: DeploymentRow;
}

export function DeploymentsClient({ role }: { role: AdminRole }) {
  const t = useTranslations('deployments');
  const tCommon = useTranslations('common');
  const tA11y = useTranslations('a11y');
  const [statusFilter, setStatusFilter] = React.useState<LifecycleStatus | undefined>(undefined);
  const [dialog, setDialog] = React.useState<DialogState | null>(null);

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

  const isOperator = role === 'operator' || role === 'superadmin';
  const isSuper = role === 'superadmin';
  const rows = data?.data ?? [];

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{t('heading')}</h1>
        <p className="text-sm text-muted-foreground">{t('subheading')}</p>
      </header>

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
                    <span className="text-muted-foreground">{d.execution_mode}</span> /{' '}
                    {d.treasury_mode}
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
              : tCommon('confirm')
          }
          description={t('confirmDescription', { id: dialog.deployment.id })}
          confirmTargetId={dialog.deployment.id}
          withReason={dialog.kind === 'force-close'}
          destructive={dialog.kind === 'force-close'}
          confirmLabel={dialog.kind === 'force-close' ? t('forceCloseTitle') : t('stopTitle')}
          loading={stop.isPending || forceClose.isPending}
          onConfirm={async ({ reason }) => {
            if (dialog.kind === 'force-close') {
              await forceClose.mutateAsync({ id: dialog.deployment.id, reason });
            } else if (dialog.kind === 'stop') {
              await stop.mutateAsync({ id: dialog.deployment.id });
            }
            setDialog(null);
          }}
        />
      ) : null}
    </div>
  );
}
