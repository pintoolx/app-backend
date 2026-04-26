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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ConfirmDialog } from '@/components/admin/confirm-dialog';
import {
  usePerTokens,
  usePrivacyOverview,
  useRevokeAllPerTokens,
  useRevokePerToken,
  type PerTokenRow,
} from '@/lib/api-hooks';
import { truncateMiddle } from '@/lib/utils';
import { format } from 'date-fns';
import type { AdminRole } from '@/lib/auth';

interface DialogState {
  kind: 'revoke-token' | 'revoke-deployment';
  target: string; // token prefix or deploymentId
  rawToken?: string; // for single-token revoke we need the prefix as the path param
}

export function PrivacyClient({ role }: { role: AdminRole }) {
  const t = useTranslations('privacy');
  const tCommon = useTranslations('common');
  const [dialog, setDialog] = React.useState<DialogState | null>(null);
  const overview = usePrivacyOverview();
  const tokens = usePerTokens();
  const revokeOne = useRevokePerToken();
  const revokeAll = useRevokeAllPerTokens();
  const isOperator = role === 'operator' || role === 'superadmin';

  const o = overview.data?.data;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{t('heading')}</h1>
        <p className="text-sm text-muted-foreground">{t('subheading')}</p>
      </header>

      {o ? (
        <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <KPI label={t('perActive')} value={o.perTokens.byStatus.active} />
          <KPI label={t('expiring24h')} value={o.perTokens.expiringIn24h} />
          <KPI label={t('snapshots24h')} value={o.snapshots.totalLast24h} />
          <KPI label={t('erDelegated')} value={o.er.delegatedDeployments} />
        </section>
      ) : null}

      {o ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('adapterStatus')}</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {Object.entries(o.adapters).map(([k, v]) => (
              <div
                key={k}
                className="flex items-center justify-between rounded-md border bg-card/50 px-3 py-2"
              >
                <span className="font-mono uppercase">{k}</span>
                <Badge variant={v === 'real' ? 'success' : 'secondary'}>{v}</Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <Tabs defaultValue="per-tokens" className="space-y-4">
        <TabsList>
          <TabsTrigger value="per-tokens">{t('perTokens')}</TabsTrigger>
        </TabsList>
        <TabsContent value="per-tokens">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                {t('tokensRedacted', { n: tokens.data?.count ?? 0 })}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('prefix')}</TableHead>
                    <TableHead>{t('deployment')}</TableHead>
                    <TableHead>{t('wallet')}</TableHead>
                    <TableHead>{tCommon('status')}</TableHead>
                    <TableHead>{t('issued')}</TableHead>
                    <TableHead>{t('expires')}</TableHead>
                    <TableHead className="text-right">{tCommon('actions')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(tokens.data?.data ?? []).length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="py-6 text-center text-muted-foreground">
                        {t('noTokens')}
                      </TableCell>
                    </TableRow>
                  ) : null}
                  {(tokens.data?.data ?? []).map((token: PerTokenRow) => (
                    <TableRow key={`${token.tokenPrefix}-${token.deploymentId}`}>
                      <TableCell className="font-mono text-xs">{token.tokenPrefix}…</TableCell>
                      <TableCell className="font-mono text-xs">
                        {token.deploymentId.slice(0, 8)}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {truncateMiddle(token.wallet, 6, 4)}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            token.status === 'active'
                              ? 'success'
                              : token.status === 'revoked'
                              ? 'destructive'
                              : 'secondary'
                          }
                        >
                          {token.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {format(new Date(token.issuedAt), 'MM-dd HH:mm')}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {format(new Date(token.expiresAt), 'MM-dd HH:mm')}
                      </TableCell>
                      <TableCell className="space-x-2 text-right">
                        {isOperator && token.status === 'active' ? (
                          <>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                setDialog({
                                  kind: 'revoke-token',
                                  target: token.tokenPrefix,
                                  rawToken: token.tokenPrefix,
                                })
                              }
                            >
                              {t('revokeToken')}
                            </Button>
                            <Button
                              size="sm"
                              variant="destructive"
                              onClick={() =>
                                setDialog({
                                  kind: 'revoke-deployment',
                                  target: token.deploymentId,
                                })
                              }
                            >
                              {t('revokeAllForDeployment')}
                            </Button>
                          </>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {dialog ? (
        <ConfirmDialog
          open
          onOpenChange={() => setDialog(null)}
          title={dialog.kind === 'revoke-token' ? t('revokeTokenTitle') : t('revokeAllTitle')}
          description={
            dialog.kind === 'revoke-token'
              ? t('revokeTokenDescription')
              : t('revokeAllDescription', { id: dialog.target })
          }
          confirmTargetId={dialog.target}
          destructive
          confirmLabel={t('revoke')}
          loading={revokeOne.isPending || revokeAll.isPending}
          onConfirm={async () => {
            if (dialog.kind === 'revoke-token' && dialog.rawToken) {
              await revokeOne.mutateAsync(dialog.rawToken);
            } else if (dialog.kind === 'revoke-deployment') {
              await revokeAll.mutateAsync(dialog.target);
            }
            setDialog(null);
          }}
        />
      ) : null}
    </div>
  );
}

function KPI({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-1 py-4">
        <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
        <span className="text-3xl font-semibold">{value.toLocaleString()}</span>
      </CardContent>
    </Card>
  );
}
