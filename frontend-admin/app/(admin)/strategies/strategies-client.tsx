'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
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
import { useStrategies, useStrategyDetail, type StrategyRow } from '@/lib/api-hooks';
import { truncateMiddle } from '@/lib/utils';
import { format } from 'date-fns';

export function StrategiesClient() {
  const t = useTranslations('strategies');
  const tCommon = useTranslations('common');
  const { data, isLoading, error } = useStrategies({ limit: 100 });
  const [detailStrategy, setDetailStrategy] = React.useState<StrategyRow | null>(null);
  const detail = useStrategyDetail(detailStrategy?.id);

  if (isLoading) return <p className="text-muted-foreground">{tCommon('loading')}</p>;
  if (error) return <p className="text-destructive">{(error as Error).message}</p>;
  const rows = data?.data ?? [];

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{t('heading')}</h1>
        <p className="text-sm text-muted-foreground">{t('subheading')}</p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('count', { n: rows.length })}</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('name')}</TableHead>
                <TableHead>{t('creator')}</TableHead>
                <TableHead>{t('visibility')}</TableHead>
                <TableHead>{t('lifecycle')}</TableHead>
                <TableHead>{t('version')}</TableHead>
                <TableHead>{t('updated')}</TableHead>
                <TableHead className="text-right" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-6 text-center text-muted-foreground">
                    {t('noStrategies')}
                  </TableCell>
                </TableRow>
              ) : null}
              {rows.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="font-medium">{s.name}</TableCell>
                  <TableCell className="font-mono text-xs">
                    {truncateMiddle(s.creator_wallet_address, 6, 4)}
                  </TableCell>
                  <TableCell>
                    <Badge variant={s.visibility_mode === 'public' ? 'success' : 'secondary'}>
                      {s.visibility_mode}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        s.lifecycle_state === 'published'
                          ? 'success'
                          : s.lifecycle_state === 'draft'
                          ? 'secondary'
                          : 'warning'
                      }
                    >
                      {s.lifecycle_state}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-mono text-xs">v{s.current_version ?? '—'}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {format(new Date(s.updated_at), 'yyyy-MM-dd HH:mm')}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="outline" onClick={() => setDetailStrategy(s)}>
                      {t('detail')}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={Boolean(detailStrategy)} onOpenChange={(open) => !open && setDetailStrategy(null)}>
        <DialogContent className="max-h-[88vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t('detailTitle', { name: detailStrategy?.name ?? '—' })}</DialogTitle>
            <DialogDescription>{t('detailDescription')}</DialogDescription>
          </DialogHeader>
          {detail.isLoading ? (
            <p className="text-sm text-muted-foreground">{tCommon('loading')}</p>
          ) : detail.error ? (
            <p className="text-sm text-destructive">{(detail.error as Error).message}</p>
          ) : detail.data?.data ? (
            <div className="space-y-4 text-sm">
              <div className="grid gap-3 md:grid-cols-2">
                <StatusRow label={t('detailId')} value={detail.data.data.id} mono />
                <StatusRow label={t('detailCreator')} value={detail.data.data.creator_wallet_address} mono />
                <StatusRow label={t('detailVisibility')} value={detail.data.data.visibility_mode} />
                <StatusRow label={t('detailLifecycle')} value={detail.data.data.lifecycle_state} />
                <StatusRow label={t('detailCurrentVersion')} value={`v${detail.data.data.current_version ?? '—'}`} />
                <StatusRow label={t('detailUpdated')} value={format(new Date(detail.data.data.updated_at), 'yyyy-MM-dd HH:mm')} />
              </div>
              {detail.data.data.description ? (
                <div className="rounded-md border bg-card/50 p-3">
                  <p className="text-muted-foreground">{detail.data.data.description}</p>
                </div>
              ) : null}
              {detail.data.data.versions.length > 0 ? (
                <div className="space-y-2">
                  <h4 className="font-medium">{t('detailVersions')}</h4>
                  <div className="space-y-2">
                    {detail.data.data.versions.map((v) => (
                      <div key={v.id} className="flex items-center justify-between rounded-md border bg-card/50 px-3 py-2">
                        <span className="font-mono text-xs">v{v.version}</span>
                        <span className="text-xs text-muted-foreground">
                          {format(new Date(v.created_at), 'yyyy-MM-dd HH:mm')}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StatusRow({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-md border bg-card/50 px-3 py-2">
      <span className="text-muted-foreground">{label}</span>
      <span className={mono ? 'font-mono text-right text-xs' : 'text-right'}>{value}</span>
    </div>
  );
}
