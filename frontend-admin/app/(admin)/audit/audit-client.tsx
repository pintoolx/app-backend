'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useAuditLog } from '@/lib/api-hooks';
import { format } from 'date-fns';

export function AuditClient() {
  const t = useTranslations('audit');
  const tCommon = useTranslations('common');
  const [action, setAction] = React.useState('');
  const [target, setTarget] = React.useState('');
  const [debouncedAction, setDebouncedAction] = React.useState('');
  const [debouncedTarget, setDebouncedTarget] = React.useState('');

  React.useEffect(() => {
    const id = setTimeout(() => setDebouncedAction(action), 300);
    return () => clearTimeout(id);
  }, [action]);
  React.useEffect(() => {
    const id = setTimeout(() => setDebouncedTarget(target), 300);
    return () => clearTimeout(id);
  }, [target]);

  const { data } = useAuditLog({
    action: debouncedAction || undefined,
    targetId: debouncedTarget || undefined,
    limit: 200,
  });

  const rows = data?.data ?? [];

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{t('heading')}</h1>
        <p className="text-sm text-muted-foreground">{t('subheading')}</p>
      </header>

      <div className="grid gap-2 sm:grid-cols-2">
        <Input
          placeholder={t('filterAction')}
          value={action}
          onChange={(e) => setAction(e.target.value)}
        />
        <Input
          placeholder={t('filterTarget')}
          value={target}
          onChange={(e) => setTarget(e.target.value)}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('count', { n: rows.length })}</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('when')}</TableHead>
                <TableHead>{t('admin')}</TableHead>
                <TableHead>{t('action')}</TableHead>
                <TableHead>{t('target')}</TableHead>
                <TableHead>{t('ip')}</TableHead>
                <TableHead>{t('status')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-6 text-center text-muted-foreground">
                    {tCommon('noEntries')}
                  </TableCell>
                </TableRow>
              ) : null}
              {rows.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="text-xs text-muted-foreground">
                    {format(new Date(e.created_at), 'yyyy-MM-dd HH:mm:ss')}
                  </TableCell>
                  <TableCell className="text-xs">{e.admin_email ?? '—'}</TableCell>
                  <TableCell className="font-mono text-xs">{e.action}</TableCell>
                  <TableCell className="font-mono text-xs">
                    {e.target_type ? `${e.target_type}:${(e.target_id ?? '').slice(0, 12)}` : '—'}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{e.ip_address ?? '—'}</TableCell>
                  <TableCell>
                    <Badge variant={e.status === 'success' ? 'success' : 'destructive'}>
                      {e.status}
                    </Badge>
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
