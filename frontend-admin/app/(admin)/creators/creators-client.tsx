'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useAdminCreators, useSetCreatorVerified, type AdminCreatorRosterRow } from '@/lib/api-hooks';
import { truncateMiddle } from '@/lib/utils';
import type { AdminRole } from '@/lib/auth';
import { BadgeCheck } from 'lucide-react';

const fmtSol = (sol: number): string => `${sol.toLocaleString(undefined, { maximumFractionDigits: 3 })} SOL`;

export function CreatorsClient({ role }: { role: AdminRole }) {
  const t = useTranslations('creators');
  const tCommon = useTranslations('common');
  const { data, isLoading, error } = useAdminCreators();
  const setVerified = useSetCreatorVerified();
  const isOperator = role === 'operator' || role === 'superadmin';
  const rows = data?.data ?? [];

  const totalMrrSol = rows.reduce((sum, r) => sum + r.mrrSol, 0);
  const totalSubscribers = rows.reduce((sum, r) => sum + r.activeSubscribers, 0);
  const verifiedCount = rows.filter((r) => r.verified).length;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{t('heading')}</h1>
        <p className="text-sm text-muted-foreground">{t('subheading')}</p>
      </header>

      <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label={t('statCreators')} value={rows.length.toLocaleString()} />
        <Stat label={t('statMrr')} value={fmtSol(totalMrrSol)} />
        <Stat label={t('statSubscribers')} value={totalSubscribers.toLocaleString()} />
        <Stat label={t('statVerified')} value={`${verifiedCount}/${rows.length}`} />
      </section>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('rosterTitle', { n: rows.length })}</CardTitle>
        </CardHeader>
        <CardContent>
          {error ? <p className="text-destructive">{(error as Error).message}</p> : null}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('colCreator')}</TableHead>
                <TableHead>{t('colVerified')}</TableHead>
                <TableHead className="text-right">{t('colPrice')}</TableHead>
                <TableHead className="text-right">{t('colSubscribers')}</TableHead>
                <TableHead className="text-right">{t('colMrr')}</TableHead>
                <TableHead className="text-right">{t('colPublished')}</TableHead>
                <TableHead>{t('colPayout')}</TableHead>
                <TableHead>{t('colActive')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={8} className="py-6 text-center text-muted-foreground">
                    {tCommon('loading')}
                  </TableCell>
                </TableRow>
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="py-6 text-center text-muted-foreground">
                    {t('empty')}
                  </TableCell>
                </TableRow>
              ) : null}
              {rows.map((row) => (
                <CreatorRow
                  key={row.creatorWallet}
                  row={row}
                  isOperator={isOperator}
                  pending={setVerified.isPending}
                  onToggleVerified={(verified) =>
                    setVerified.mutate({ wallet: row.creatorWallet, verified })
                  }
                />
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function CreatorRow({
  row,
  isOperator,
  pending,
  onToggleVerified,
}: {
  row: AdminCreatorRosterRow;
  isOperator: boolean;
  pending: boolean;
  onToggleVerified: (verified: boolean) => void;
}) {
  return (
    <TableRow>
      <TableCell>
        <div className="flex flex-col">
          <span className="text-sm font-medium">
            {row.displayName ?? truncateMiddle(row.creatorWallet, 6, 4)}
          </span>
          {row.displayName ? (
            <span className="font-mono text-[10px] text-muted-foreground">
              {truncateMiddle(row.creatorWallet, 6, 4)}
            </span>
          ) : null}
        </div>
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-2">
          {row.verified ? <BadgeCheck className="h-4 w-4 text-emerald-500" /> : null}
          {isOperator ? (
            <Switch
              checked={row.verified}
              disabled={pending}
              onCheckedChange={(v) => onToggleVerified(Boolean(v))}
            />
          ) : (
            <Badge variant={row.verified ? 'success' : 'secondary'}>
              {row.verified ? 'verified' : '—'}
            </Badge>
          )}
        </div>
      </TableCell>
      <TableCell className="text-right font-mono text-xs">{fmtSol(row.monthlyPriceSol)}</TableCell>
      <TableCell className="text-right font-mono text-xs">{row.activeSubscribers}</TableCell>
      <TableCell className="text-right font-mono text-xs">{fmtSol(row.mrrSol)}</TableCell>
      <TableCell className="text-right font-mono text-xs">{row.publishedStrategies}</TableCell>
      <TableCell className="font-mono text-xs">{truncateMiddle(row.payoutWallet, 6, 4)}</TableCell>
      <TableCell>
        <Badge variant={row.isActive ? 'success' : 'secondary'}>
          {row.isActive ? 'active' : 'inactive'}
        </Badge>
      </TableCell>
    </TableRow>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-1 py-4">
        <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
        <span className="text-2xl font-semibold">{value}</span>
      </CardContent>
    </Card>
  );
}
