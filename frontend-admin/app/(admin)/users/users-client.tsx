'use client';

import * as React from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ConfirmDialog } from '@/components/admin/confirm-dialog';
import {
  useBanWallet,
  useBannedWallets,
  useUnbanWallet,
  useUsers,
} from '@/lib/api-hooks';
import { truncateMiddle } from '@/lib/utils';
import { formatDistanceToNow } from 'date-fns';
import { DATE_FNS_LOCALES, normalizeLocale } from '@/i18n/config';
import type { AdminRole } from '@/lib/auth';

interface DialogState {
  kind: 'ban' | 'unban';
  wallet: string;
}

export function UsersClient({ role }: { role: AdminRole }) {
  const locale = useLocale();
  const t = useTranslations('users');
  const tCommon = useTranslations('common');
  const dateLocale = DATE_FNS_LOCALES[normalizeLocale(locale)];
  const [search, setSearch] = React.useState('');
  const [debounced, setDebounced] = React.useState('');
  const [dialog, setDialog] = React.useState<DialogState | null>(null);

  React.useEffect(() => {
    const id = setTimeout(() => setDebounced(search), 300);
    return () => clearTimeout(id);
  }, [search]);

  const usersQuery = useUsers({ search: debounced || undefined, limit: 100 });
  const bannedQuery = useBannedWallets();
  const banMutation = useBanWallet();
  const unbanMutation = useUnbanWallet();

  const bannedSet = React.useMemo(
    () => new Set((bannedQuery.data?.data ?? []).map((b) => b.wallet)),
    [bannedQuery.data],
  );

  const isSuper = role === 'superadmin';

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{t('heading')}</h1>
        <p className="text-sm text-muted-foreground">{t('subheading')}</p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('bannedTitle', { count: bannedSet.size })}</CardTitle>
        </CardHeader>
        <CardContent>
          {bannedQuery.data && bannedQuery.data.data.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('noBans')}</p>
          ) : (
            <ul className="divide-y text-sm">
              {bannedQuery.data?.data.map((b) => (
                <li
                  key={b.wallet}
                  className="flex flex-wrap items-center justify-between gap-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="font-mono">{truncateMiddle(b.wallet, 8, 6)}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {b.reason ?? t('noReason')} ·{' '}
                      {t('bannedBy', { who: b.banned_by ?? tCommon('unknown') })}
                    </p>
                  </div>
                  {isSuper ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setDialog({ kind: 'unban', wallet: b.wallet })}
                    >
                      {t('unban')}
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
          <CardTitle className="text-base">{t('walletsTitle')}</CardTitle>
          <Input
            placeholder={t('filterPlaceholder')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-xs"
          />
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('wallet')}</TableHead>
                <TableHead>{t('accounts')}</TableHead>
                <TableHead>{t('created')}</TableHead>
                <TableHead>{t('lastActive')}</TableHead>
                <TableHead className="w-32">{t('status')}</TableHead>
                <TableHead className="w-32 text-right">{tCommon('actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(usersQuery.data?.data ?? []).map((u) => {
                const banned = bannedSet.has(u.walletAddress);
                return (
                  <TableRow key={u.walletAddress}>
                    <TableCell className="font-mono text-xs">
                      {truncateMiddle(u.walletAddress, 8, 6)}
                    </TableCell>
                    <TableCell>{u.accountCount}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {u.createdAt
                        ? formatDistanceToNow(new Date(u.createdAt), {
                            addSuffix: true,
                            locale: dateLocale,
                          })
                        : '—'}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {u.lastActiveAt
                        ? formatDistanceToNow(new Date(u.lastActiveAt), {
                            addSuffix: true,
                            locale: dateLocale,
                          })
                        : '—'}
                    </TableCell>
                    <TableCell>
                      {banned ? (
                        <Badge variant="destructive">{tCommon('banned')}</Badge>
                      ) : (
                        <Badge variant="success">{tCommon('active')}</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {isSuper ? (
                        banned ? (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              setDialog({ kind: 'unban', wallet: u.walletAddress })
                            }
                          >
                            {t('unban')}
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => setDialog({ kind: 'ban', wallet: u.walletAddress })}
                          >
                            {t('ban')}
                          </Button>
                        )
                      ) : null}
                    </TableCell>
                  </TableRow>
                );
              })}
              {(usersQuery.data?.data ?? []).length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-6 text-center text-muted-foreground">
                    {t('noUsers')}
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {dialog ? (
        <ConfirmDialog
          open
          onOpenChange={() => setDialog(null)}
          title={dialog.kind === 'ban' ? t('banTitle') : t('unbanTitle')}
          description={t('banDescription', { wallet: dialog.wallet })}
          confirmTargetId={dialog.wallet}
          withReason={dialog.kind === 'ban'}
          destructive={dialog.kind === 'ban'}
          confirmLabel={dialog.kind === 'ban' ? t('banTitle') : t('unban')}
          loading={banMutation.isPending || unbanMutation.isPending}
          onConfirm={async ({ reason }) => {
            if (dialog.kind === 'ban') {
              await banMutation.mutateAsync({
                wallet: dialog.wallet,
                reason,
                expiresAt: null,
              });
            } else {
              await unbanMutation.mutateAsync(dialog.wallet);
            }
            setDialog(null);
          }}
        />
      ) : null}
    </div>
  );
}
