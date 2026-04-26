'use client';

import { useTranslations } from 'next-intl';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useStrategies } from '@/lib/api-hooks';
import { truncateMiddle } from '@/lib/utils';
import { format } from 'date-fns';

export function StrategiesClient() {
  const t = useTranslations('strategies');
  const tCommon = useTranslations('common');
  const { data, isLoading, error } = useStrategies({ limit: 100 });
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
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-6 text-center text-muted-foreground">
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
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
