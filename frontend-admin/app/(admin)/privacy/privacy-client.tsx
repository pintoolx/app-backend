'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { format } from 'date-fns';
import {
  AlertCircle,
  Activity,
  Camera,
  CheckCircle,
  Clock,
  Coins,
  Eye,
  FileText,
  HelpCircle,
  KeyRound,
  Lightbulb,
  Server,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
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
import type { AdminRole } from '@/lib/auth';
import {
  FollowerVaultsTab,
  PrivateCyclesTab,
  SubscriptionsTab,
  UmbraIdentitiesTab,
  VisibilityGrantsTab,
} from './follower-vault-sections';

interface DialogState {
  kind: 'revoke-token' | 'revoke-deployment';
  target: string;
  rawToken?: string;
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

  const targetModules = [
    {
      key: 'follower-vaults',
      title: t('targetFollowerVaultsTitle'),
      summary: t('targetFollowerVaultsSummary'),
      endpoint: 'GET /admin/privacy/follower-vaults',
      hook: 'useFollowerVaults()',
    },
    {
      key: 'subscriptions',
      title: t('targetSubscriptionsTitle'),
      summary: t('targetSubscriptionsSummary'),
      endpoint: 'GET /admin/privacy/subscriptions',
      hook: 'useSubscriptions()',
    },
    {
      key: 'identities',
      title: t('targetUmbraIdentitiesTitle'),
      summary: t('targetUmbraIdentitiesSummary'),
      endpoint: 'GET /admin/privacy/umbra-identities',
      hook: 'useUmbraIdentityInventory()',
    },
    {
      key: 'grants',
      title: t('targetGrantsTitle'),
      summary: t('targetGrantsSummary'),
      endpoint: 'GET /admin/privacy/visibility-grants',
      hook: 'useVisibilityGrants()',
    },
    {
      key: 'cycles',
      title: t('targetCyclesTitle'),
      summary: t('targetCyclesSummary'),
      endpoint: 'GET /admin/privacy/private-cycles',
      hook: 'usePrivateExecutionCycles()',
    },
  ];

  const backendBacklog = [
    {
      key: 'vaults',
      label: 'GET /admin/privacy/follower-vaults',
      note: t('backlogFollowerVaults'),
    },
    {
      key: 'subscriptions',
      label: 'GET /admin/privacy/subscriptions',
      note: t('backlogSubscriptions'),
    },
    {
      key: 'grants',
      label: 'GET /admin/privacy/visibility-grants',
      note: t('backlogGrants'),
    },
    {
      key: 'cycles',
      label: 'GET /admin/privacy/private-cycles',
      note: t('backlogCycles'),
    },
    {
      key: 'deployment-vaults',
      label: 'GET /admin/privacy/deployments/:id/follower-vaults',
      note: t('backlogDeploymentVaults'),
    },
  ];

  const hookBacklog = [
    { key: 'vaults', label: 'useFollowerVaults()', note: t('hookFollowerVaults') },
    { key: 'subscriptions', label: 'useSubscriptions()', note: t('hookSubscriptions') },
    { key: 'grants', label: 'useVisibilityGrants()', note: t('hookGrants') },
    { key: 'cycles', label: 'usePrivateExecutionCycles()', note: t('hookCycles') },
    {
      key: 'identities',
      label: 'useUmbraIdentityInventory()',
      note: t('hookUmbraIdentities'),
    },
  ];

  const pageBacklog = [
    { key: 'privacy', label: t('pagePrivacyLabel'), note: t('pagePrivacyNote') },
    {
      key: 'deployments',
      label: t('pageDeploymentsLabel'),
      note: t('pageDeploymentsNote'),
    },
    { key: 'overview', label: t('pageOverviewLabel'), note: t('pageOverviewNote') },
    { key: 'system', label: t('pageSystemLabel'), note: t('pageSystemNote') },
  ];

  return (
    <div className="space-y-6">
      <header className="space-y-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t('heading')}</h1>
          <p className="text-sm text-muted-foreground">{t('subheading')}</p>
        </div>

        <Card className="overflow-hidden border-0 bg-[linear-gradient(135deg,hsl(var(--background))_0%,rgba(18,49,65,0.96)_55%,rgba(12,22,34,1)_100%)] text-white shadow-sm">
          <CardContent className="space-y-6 p-6">
            <div className="max-w-3xl space-y-2">
              <Badge variant="outline" className="border-white/20 bg-white/10 text-white">
                {t('nativePrivacyBlueprint')}
              </Badge>
              <h2 className="text-xl font-semibold leading-tight">{t('architectureTitle')}</h2>
              <p className="text-sm leading-6 text-white/70">{t('architectureSummary')}</p>
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              <ArchitectureLane
                badge={t('architectureCurrentSurface')}
                title={t('controlShellTitle')}
                summary={t('controlShellSummary')}
                bullets={[
                  t('controlShellBullet1'),
                  t('controlShellBullet2'),
                  t('controlShellBullet3'),
                ]}
              />
              <ArchitectureLane
                badge={t('architecturePrivateRuntime')}
                title={t('perRuntimeTitle')}
                summary={t('perRuntimeSummary')}
                bullets={[
                  t('perRuntimeBullet1'),
                  t('perRuntimeBullet2'),
                  t('perRuntimeBullet3'),
                ]}
              />
              <ArchitectureLane
                badge={t('architecturePrivateTreasury')}
                title={t('umbraTreasuryTitle')}
                summary={t('umbraTreasurySummary')}
                bullets={[
                  t('umbraTreasuryBullet1'),
                  t('umbraTreasuryBullet2'),
                  t('umbraTreasuryBullet3'),
                ]}
              />
            </div>
          </CardContent>
        </Card>
      </header>

      {o ? (
        <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <KPI
            label={t('perActive')}
            value={o.perTokens.byStatus.active}
            icon={<KeyRound className="h-4 w-4 text-muted-foreground" />}
          />
          <KPI
            label={t('expiring24h')}
            value={o.perTokens.expiringIn24h}
            icon={<Clock className="h-4 w-4 text-amber-500" />}
          />
          <KPI
            label={t('snapshots24h')}
            value={o.snapshots.totalLast24h}
            icon={<Camera className="h-4 w-4 text-muted-foreground" />}
          />
          <KPI
            label={t('erDelegated')}
            value={o.er.delegatedDeployments}
            icon={<Server className="h-4 w-4 text-muted-foreground" />}
          />
        </section>
      ) : null}

      {o ? (
        <Card>
          <CardHeader className="space-y-2">
            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-emerald-500" />
              <CardTitle className="text-base">{t('nativeCoverageHeading')}</CardTitle>
            </div>
            <p className="text-sm text-muted-foreground">{t('nativeCoverageSubtitle')}</p>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
            <KPI
              label={t('kpiActiveVaults')}
              value={o.followerVaults.byStatus.active}
              icon={<Coins className="h-4 w-4 text-emerald-500" />}
            />
            <KPI
              label={t('kpiPendingFundingVaults')}
              value={o.followerVaults.byStatus.pending_funding}
              icon={<Clock className="h-4 w-4 text-amber-500" />}
            />
            <KPI
              label={t('kpiActiveSubscriptions')}
              value={o.subscriptions.byStatus.active}
              icon={<FileText className="h-4 w-4 text-muted-foreground" />}
            />
            <KPI
              label={t('kpiSubscriptionsWithIdentity')}
              value={o.subscriptions.withUmbraIdentity}
              icon={<ShieldCheck className="h-4 w-4 text-emerald-500" />}
            />
            <KPI
              label={t('kpiCyclesLast24h')}
              value={o.privateCycles.last24h}
              icon={<Activity className="h-4 w-4 text-muted-foreground" />}
            />
            <KPI
              label={t('kpiCompletedCycles24h')}
              value={o.privateCycles.completedLast24h}
              icon={<CheckCircle className="h-4 w-4 text-emerald-500" />}
            />
            <KPI
              label={t('kpiFailedCycles24h')}
              value={o.privateCycles.failedLast24h}
              icon={<XCircle className="h-4 w-4 text-destructive" />}
            />
            <KPI
              label={t('kpiActiveGrants')}
              value={o.visibilityGrants.active}
              icon={<Eye className="h-4 w-4 text-emerald-500" />}
            />
            <KPI
              label={t('kpiExpiredGrants')}
              value={o.visibilityGrants.expired}
              icon={<Clock className="h-4 w-4 text-amber-500" />}
            />
            <KPI
              label={t('kpiRevokedGrants')}
              value={o.visibilityGrants.revoked}
              icon={<XCircle className="h-4 w-4 text-muted-foreground" />}
            />
          </CardContent>
        </Card>
      ) : null}

      <Tabs defaultValue="current" className="space-y-4">
        <TabsList className="flex flex-wrap">
          <TabsTrigger value="current">{t('tabCurrent')}</TabsTrigger>
          <TabsTrigger value="vaults">{t('tabVaults')}</TabsTrigger>
          <TabsTrigger value="subscriptions">{t('tabSubscriptions')}</TabsTrigger>
          <TabsTrigger value="cycles">{t('tabCycles')}</TabsTrigger>
          <TabsTrigger value="identities">{t('tabIdentities')}</TabsTrigger>
          <TabsTrigger value="grants">{t('tabGrants')}</TabsTrigger>
          <TabsTrigger value="target">{t('tabTarget')}</TabsTrigger>
          <TabsTrigger value="backlog">{t('tabBacklog')}</TabsTrigger>
        </TabsList>

        <TabsContent value="current" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader className="flex flex-row items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-muted-foreground" />
                <CardTitle className="text-base">{t('adapterStatus')}</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-2">
                {Object.entries(o?.adapters ?? {}).map(([key, value]) => (
                  <div
                    key={key}
                    className="flex items-center justify-between rounded-md border bg-card/50 px-3 py-2"
                  >
                    <span className="font-mono uppercase">{key}</span>
                    <Badge variant={value === 'real' ? 'success' : 'secondary'}>{value}</Badge>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-muted-foreground" />
                <CardTitle className="text-base">{t('umbraRegistrations')}</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-2">
                <UmbraStat
                  label={t('umbraConfirmed')}
                  value={o?.umbra.registrations.confirmed ?? 0}
                  icon={<CheckCircle className="h-3.5 w-3.5 text-emerald-500" />}
                />
                <UmbraStat
                  label={t('umbraPending')}
                  value={o?.umbra.registrations.pending ?? 0}
                  icon={<AlertCircle className="h-3.5 w-3.5 text-amber-500" />}
                />
                <UmbraStat
                  label={t('umbraFailed')}
                  value={o?.umbra.registrations.failed ?? 0}
                  icon={<XCircle className="h-3.5 w-3.5 text-destructive" />}
                />
                <UmbraStat
                  label={t('umbraUnset')}
                  value={o?.umbra.registrations.unset ?? 0}
                  icon={<HelpCircle className="h-3.5 w-3.5 text-muted-foreground" />}
                />
              </CardContent>
            </Card>
          </div>

          {o ? (
            <div className="grid gap-4 md:grid-cols-[1.4fr,1fr]">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">{t('currentRealityTitle')}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <StatusRow label={t('seedSourceLabel')} value={o.umbra.seedSource ?? tCommon('unknown')} />
                  <StatusRow
                    label={t('seedFingerprintLabel')}
                    value={o.umbra.seedFingerprint ?? t('notConfigured')}
                    mono
                  />
                  <StatusRow
                    label={t('latestSnapshotLabel')}
                    value={
                      o.snapshots.latestPublishedAt
                        ? format(new Date(o.snapshots.latestPublishedAt), 'yyyy-MM-dd HH:mm')
                        : t('noSnapshotsYet')
                    }
                  />
                  <StatusRow
                    label={t('snapshotRevisionLabel')}
                    value={o.snapshots.latestRevision ?? t('notAvailable')}
                  />
                  <StatusRow
                    label={t('expiring7dLabel')}
                    value={o.perTokens.expiringIn7d.toLocaleString()}
                  />
                </CardContent>
              </Card>

              <Card className="border-warning/30 bg-warning/5">
                <CardHeader>
                  <CardTitle className="text-base">{t('implementationGapTitle')}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm text-muted-foreground">
                  <p>{t('implementationGapIntro')}</p>
                  <GapPill text={t('gapSharedIdentity')} />
                  <GapPill text={t('gapPerReadPath')} />
                  <GapPill text={t('gapFollowerRuntime')} />
                  <GapPill text={t('gapVisibilityGrants')} />
                </CardContent>
              </Card>
            </div>
          ) : null}

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
                      <TableCell className="font-mono text-xs">{token.tokenPrefix}</TableCell>
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

        <TabsContent value="vaults" className="space-y-4">
          <FollowerVaultsTab role={role} />
        </TabsContent>

        <TabsContent value="subscriptions" className="space-y-4">
          <SubscriptionsTab />
        </TabsContent>

        <TabsContent value="cycles" className="space-y-4">
          <PrivateCyclesTab role={role} />
        </TabsContent>

        <TabsContent value="identities" className="space-y-4">
          <UmbraIdentitiesTab />
        </TabsContent>

        <TabsContent value="grants" className="space-y-4">
          <VisibilityGrantsTab role={role} />
        </TabsContent>

        <TabsContent value="target" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t('targetBlueprintTitle')}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
                {t('targetBlueprintSummary')}
              </p>
            </CardContent>
          </Card>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {targetModules.map((module) => (
              <Card key={module.key} className="border-border/70 bg-card/70">
                <CardHeader className="space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <CardTitle className="text-base">{module.title}</CardTitle>
                    <Badge variant="warning">{t('plannedApiBadge')}</Badge>
                  </div>
                  <p className="text-sm leading-6 text-muted-foreground">{module.summary}</p>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <StatusRow label={t('targetEndpointLabel')} value={module.endpoint} mono />
                  <StatusRow label={t('targetHookLabel')} value={module.hook} mono />
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="backlog" className="space-y-4">
          <div className="grid gap-4 xl:grid-cols-3">
            <BacklogCard title={t('backendBacklogTitle')} items={backendBacklog} />
            <BacklogCard title={t('hookBacklogTitle')} items={hookBacklog} />
            <BacklogCard title={t('pageBacklogTitle')} items={pageBacklog} />
          </div>
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

function KPI({ label, value, icon }: { label: string; value: number; icon?: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-2 py-4">
        <div className="flex items-center gap-2">
          {icon}
          <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
        </div>
        <span className="text-3xl font-semibold">{value.toLocaleString()}</span>
      </CardContent>
    </Card>
  );
}

function UmbraStat({ label, value, icon }: { label: string; value: number; icon?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between rounded-md border bg-card/50 px-3 py-2">
      <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
        {icon}
        <span>{label}</span>
      </div>
      <span className="font-mono text-sm font-semibold">{value}</span>
    </div>
  );
}

function ArchitectureLane({
  badge,
  title,
  summary,
  bullets,
}: {
  badge: string;
  title: string;
  summary: string;
  bullets: string[];
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4 backdrop-blur-sm">
      <div className="space-y-3">
        <Badge variant="outline" className="border-white/15 bg-white/5 text-white/80">
          {badge}
        </Badge>
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-white/80">{title}</h3>
          <p className="mt-2 text-sm leading-6 text-white/65">{summary}</p>
        </div>
        <div className="space-y-2 text-sm text-white/75">
          {bullets.map((bullet) => (
            <div key={bullet} className="rounded-lg border border-white/10 bg-black/15 px-3 py-2">
              {bullet}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function StatusRow({
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

function GapPill({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-warning/20 bg-background/70 px-3 py-2">
      <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
      <span>{text}</span>
    </div>
  );
}

function BacklogCard({
  title,
  items,
}: {
  title: string;
  items: Array<{ key: string; label: string; note: string }>;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {items.map((item) => (
          <div key={item.key} className="rounded-md border bg-card/50 p-3">
            <div className="flex items-center justify-between gap-3">
              <span className="font-mono text-xs">{item.label}</span>
              <Badge variant="secondary">draft</Badge>
            </div>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">{item.note}</p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
