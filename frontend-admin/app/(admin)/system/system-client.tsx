'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { ConfirmDialog } from '@/components/admin/confirm-dialog';
import {
  useAdapterMatrix,
  useKeeperStatus,
  useMaintenance,
  useSetMaintenance,
  useSystemHealth,
} from '@/lib/api-hooks';
import { format } from 'date-fns';
import type { AdminRole } from '@/lib/auth';

export function SystemClient({ role }: { role: AdminRole }) {
  const t = useTranslations('system');
  const tCommon = useTranslations('common');
  const tMaintenance = useTranslations('maintenance');
  const adapters = useAdapterMatrix();
  const health = useSystemHealth();
  const keeper = useKeeperStatus();
  const maintenance = useMaintenance();
  const setMaintenance = useSetMaintenance();

  const [maintMessage, setMaintMessage] = React.useState('');
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const isSuper = role === 'superadmin';

  React.useEffect(() => {
    if (maintenance.data?.data?.message) {
      setMaintMessage(maintenance.data.data.message);
    }
  }, [maintenance.data]);

  const m = maintenance.data?.data;
  const k = keeper.data?.data;
  const a = adapters.data?.data ?? [];

  const onToggle = (next: boolean) => {
    if (next) {
      setConfirmOpen(true);
    } else {
      setMaintenance.mutate({ enabled: false, message: maintMessage || null });
    }
  };

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{t('heading')}</h1>
        <p className="text-sm text-muted-foreground">{t('subheading')}</p>
      </header>

      <section className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('healthTitle')}</CardTitle>
          </CardHeader>
          <CardContent>
            {health.isLoading ? (
              <p className="text-muted-foreground">{tCommon('loading')}</p>
            ) : (
              <pre className="max-h-72 overflow-auto rounded-md bg-muted p-3 text-xs">
                {JSON.stringify(health.data?.data ?? {}, null, 2)}
              </pre>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('keeperTitle')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row label={t('publicKey')} value={k?.publicKey ? <Mono>{k.publicKey}</Mono> : '—'} />
            <Row
              label={t('initialized')}
              value={
                <Badge variant={k?.initialized ? 'success' : 'secondary'}>
                  {k?.initialized ? t('yes') : t('no')}
                </Badge>
              }
            />
            <Row
              label={t('balance')}
              value={k?.balanceSol == null ? '—' : k.balanceSol.toFixed(4)}
            />
            <Row
              label={t('warning')}
              value={
                k?.warningLevel ? (
                  <Badge
                    variant={
                      k.warningLevel === 'critical'
                        ? 'destructive'
                        : k.warningLevel === 'low'
                        ? 'warning'
                        : 'success'
                    }
                  >
                    {k.warningLevel}
                  </Badge>
                ) : (
                  '—'
                )
              }
            />
          </CardContent>
        </Card>
      </section>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('adapterMatrix')}</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {a.map((entry) => (
            <div
              key={entry.adapter}
              className="flex items-center justify-between rounded-md border bg-card/50 px-3 py-2"
            >
              <span className="font-mono uppercase">{entry.adapter}</span>
              <Badge variant={entry.mode === 'real' ? 'success' : 'secondary'}>
                {entry.mode}
              </Badge>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            {tMaintenance('label')}
            {m?.enabled ? <Badge variant="warning">{tCommon('on')}</Badge> : <Badge variant="success">{tCommon('off')}</Badge>}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {m?.enabled ? (
            <p className="text-sm text-muted-foreground">
              {tMaintenance('startedAt', {
                when: m.startedAt ? format(new Date(m.startedAt), 'yyyy-MM-dd HH:mm') : '—',
                who: m.startedBy ?? tCommon('unknown'),
              })}
            </p>
          ) : null}
          <div className="space-y-2">
            <Label htmlFor="maint-message">{tMaintenance('messageLabel')}</Label>
            <Textarea
              id="maint-message"
              value={maintMessage}
              onChange={(e) => setMaintMessage(e.target.value)}
              maxLength={512}
              disabled={!isSuper}
              placeholder={tMaintenance('messagePlaceholder')}
            />
          </div>
          <div className="flex items-center gap-3">
            <Switch
              checked={m?.enabled ?? false}
              onCheckedChange={onToggle}
              disabled={!isSuper || setMaintenance.isPending}
              aria-label={tMaintenance('label')}
            />
            <span className="text-sm text-muted-foreground">
              {isSuper
                ? tMaintenance('switchHint')
                : tMaintenance('switchHintReadOnly')}
            </span>
          </div>
        </CardContent>
      </Card>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={tMaintenance('enableTitle')}
        description={tMaintenance('enableDescription')}
        confirmTargetId="ENABLE"
        destructive
        confirmLabel={tMaintenance('enableConfirm')}
        loading={setMaintenance.isPending}
        onConfirm={async () => {
          await setMaintenance.mutateAsync({ enabled: true, message: maintMessage || null });
          setConfirmOpen(false);
        }}
      />
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span>{value}</span>
    </div>
  );
}

function Mono({ children }: { children: React.ReactNode }) {
  return (
    <span className="font-mono text-xs" title={typeof children === 'string' ? children : undefined}>
      {typeof children === 'string' ? children.slice(0, 12) + '…' : children}
    </span>
  );
}
