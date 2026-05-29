'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { format } from 'date-fns';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  useRevenueSummary,
  useRevenuePayments,
  useRevenueBuyouts,
  useTreasuryAum,
} from '@/lib/api-hooks';
import { truncateMiddle } from '@/lib/utils';

const LAMPORTS_PER_SOL = 1_000_000_000;

const fmtSol = (sol?: number): string =>
  sol == null ? '—' : `${sol.toLocaleString(undefined, { maximumFractionDigits: 3 })} SOL`;

const lamportsToSol = (lamports: string): string => {
  try {
    return fmtSol(Number(BigInt(lamports)) / LAMPORTS_PER_SOL);
  } catch {
    return '—';
  }
};

export function RevenueClient() {
  const t = useTranslations('revenue');
  const tCommon = useTranslations('common');
  const summary = useRevenueSummary();
  const payments = useRevenuePayments({ limit: 200 });
  const buyouts = useRevenueBuyouts({ limit: 200 });
  const s = summary.data?.data;
  const paymentRows = payments.data?.data ?? [];
  const buyoutRows = buyouts.data?.data ?? [];

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{t('heading')}</h1>
        <p className="text-sm text-muted-foreground">{t('subheading')}</p>
      </header>

      <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label={t('mrr')} value={fmtSol(s?.mrr.sol)} hint={t('mrrHint', { n: s?.mrr.activeSubscriptions ?? 0 })} />
        <Stat label={t('collected30d')} value={fmtSol(s?.collectedLast30d.sol)} hint={t('buyouts30d', { n: s?.buyouts.last30d ?? 0 })} />
        <Stat label={t('lifetime')} value={fmtSol(s?.lifetimeCollected.sol)} />
        <Stat
          label={t('rejectionRate')}
          value={`${((s?.payments.rejectionRateBps ?? 0) / 100).toFixed(1)}%`}
          hint={t('rejectionHint', {
            rejected: s?.payments.rejectedLast30d ?? 0,
            confirmed: s?.payments.confirmedLast30d ?? 0,
          })}
        />
      </section>

      <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label={t('subsActive')} value={String(s?.subscriptions.byStatus.active ?? 0)} />
        <Stat label={t('subsPaymentRequired')} value={String(s?.subscriptions.byStatus.payment_required ?? 0)} />
        <Stat label={t('subsCancelled')} value={String(s?.subscriptions.byStatus.cancelled ?? 0)} />
        <Stat label={t('plans')} value={`${s?.plans.active ?? 0}/${s?.plans.total ?? 0}`} hint={t('plansVerified', { n: s?.plans.verified ?? 0 })} />
      </section>

      {s?.truncated ? (
        <p className="text-xs text-amber-600">{t('truncatedNote')}</p>
      ) : null}

      <Tabs defaultValue="payments" className="space-y-4">
        <TabsList>
          <TabsTrigger value="payments">{t('tabPayments')}</TabsTrigger>
          <TabsTrigger value="buyouts">{t('tabBuyouts')}</TabsTrigger>
          <TabsTrigger value="treasury">{t('tabTreasury')}</TabsTrigger>
        </TabsList>

        <TabsContent value="payments">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t('paymentsTitle', { n: paymentRows.length })}</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('colDate')}</TableHead>
                    <TableHead>{t('colCreator')}</TableHead>
                    <TableHead>{t('colSubscriber')}</TableHead>
                    <TableHead className="text-right">{t('colAmount')}</TableHead>
                    <TableHead>{t('colStatus')}</TableHead>
                    <TableHead>{t('colPeriod')}</TableHead>
                    <TableHead>{t('colTx')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {payments.isLoading ? (
                    <TableRow>
                      <TableCell colSpan={7} className="py-6 text-center text-muted-foreground">
                        {tCommon('loading')}
                      </TableCell>
                    </TableRow>
                  ) : paymentRows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="py-6 text-center text-muted-foreground">
                        {t('emptyPayments')}
                      </TableCell>
                    </TableRow>
                  ) : null}
                  {paymentRows.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="text-xs text-muted-foreground">
                        {format(new Date(row.created_at), 'MM-dd HH:mm')}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {truncateMiddle(row.creator_wallet, 6, 4)}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {truncateMiddle(row.subscriber_wallet, 6, 4)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {lamportsToSol(row.amount)}
                      </TableCell>
                      <TableCell>
                        <Badge variant={row.status === 'confirmed' ? 'success' : 'destructive'}>
                          {row.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {format(new Date(row.period_start), 'MM-dd')} →{' '}
                        {format(new Date(row.period_end), 'MM-dd')}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {truncateMiddle(row.tx_signature, 6, 6)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="buyouts">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t('buyoutsTitle', { n: buyoutRows.length })}</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('colDate')}</TableHead>
                    <TableHead>{t('colStrategy')}</TableHead>
                    <TableHead>{t('colBuyer')}</TableHead>
                    <TableHead className="text-right">{t('colAmount')}</TableHead>
                    <TableHead>{t('colPayout')}</TableHead>
                    <TableHead>{t('colTx')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {buyouts.isLoading ? (
                    <TableRow>
                      <TableCell colSpan={6} className="py-6 text-center text-muted-foreground">
                        {tCommon('loading')}
                      </TableCell>
                    </TableRow>
                  ) : buyoutRows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="py-6 text-center text-muted-foreground">
                        {t('emptyBuyouts')}
                      </TableCell>
                    </TableRow>
                  ) : null}
                  {buyoutRows.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="text-xs text-muted-foreground">
                        {format(new Date(row.created_at), 'MM-dd HH:mm')}
                      </TableCell>
                      <TableCell className="font-mono text-xs">{row.strategy_id.slice(0, 8)}</TableCell>
                      <TableCell className="font-mono text-xs">
                        {truncateMiddle(row.buyer_wallet, 6, 4)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {lamportsToSol(row.price_amount)}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {truncateMiddle(row.payout_wallet, 6, 4)}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {truncateMiddle(row.payment_tx_signature, 6, 6)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="treasury">
          <TreasuryTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function TreasuryTab() {
  const t = useTranslations('revenue');
  const tCommon = useTranslations('common');
  const [mintInput, setMintInput] = React.useState('');
  const [mint, setMint] = React.useState<string | undefined>(undefined);
  const aum = useTreasuryAum({ mint, limit: 200 });
  const data = aum.data?.data;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setMint(mintInput.trim() || undefined);
  };

  return (
    <Card>
      <CardHeader className="space-y-3">
        <CardTitle className="text-base">{t('treasuryTitle')}</CardTitle>
        <p className="text-sm text-muted-foreground">{t('treasurySubtitle')}</p>
        <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <Label htmlFor="aum-mint" className="text-xs">
              {t('treasuryMintLabel')}
            </Label>
            <Input
              id="aum-mint"
              value={mintInput}
              onChange={(e) => setMintInput(e.target.value)}
              placeholder={t('treasuryMintPlaceholder')}
              className="w-[420px] max-w-full font-mono text-xs"
            />
          </div>
          <Button type="submit" size="sm" disabled={!mintInput.trim()}>
            {t('treasuryLoad')}
          </Button>
        </form>
      </CardHeader>
      <CardContent className="space-y-4">
        {!mint ? (
          <p className="text-sm text-muted-foreground">{t('treasuryPrompt')}</p>
        ) : aum.isLoading ? (
          <p className="text-sm text-muted-foreground">{tCommon('loading')}</p>
        ) : aum.error ? (
          <p className="text-sm text-destructive">{(aum.error as Error).message}</p>
        ) : data ? (
          <>
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <Stat
                label={t('treasuryTotalAum')}
                value={data.totalUiAmount.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                hint={truncateMiddle(data.mint, 4, 4)}
              />
              <Stat label={t('treasuryFunded')} value={String(data.fundedVaults)} />
              <Stat label={t('treasuryVaultsRead')} value={String(data.vaultsRead)} />
              <Stat label={t('treasuryDecimals')} value={String(data.decimals)} />
            </div>
            {data.truncated ? (
              <p className="text-xs text-amber-600">{t('treasuryTruncated')}</p>
            ) : null}
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('colVault')}</TableHead>
                  <TableHead>{t('colDeploymentShort')}</TableHead>
                  <TableHead>{t('colLifecycle')}</TableHead>
                  <TableHead>{t('colCustody')}</TableHead>
                  <TableHead className="text-right">{t('colBalance')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.vaults.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="py-6 text-center text-muted-foreground">
                      {t('emptyVaults')}
                    </TableCell>
                  </TableRow>
                ) : null}
                {data.vaults.map((v) => (
                  <TableRow key={v.vaultId}>
                    <TableCell className="font-mono text-xs">{v.vaultId.slice(0, 8)}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {truncateMiddle(v.deploymentId, 6, 4)}
                    </TableCell>
                    <TableCell className="text-xs">{v.lifecycleStatus}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{v.custodyMode}</TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {v.exists
                        ? v.uiAmount.toLocaleString(undefined, { maximumFractionDigits: 4 })
                        : '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-1 py-4">
        <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
        <span className="text-2xl font-semibold">{value}</span>
        {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
      </CardContent>
    </Card>
  );
}
