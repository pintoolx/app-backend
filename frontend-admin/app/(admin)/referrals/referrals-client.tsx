'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  useAdminGenerateReferralCodes,
  useIncreaseReferralQuota,
  useSetReferralQuota,
} from '@/lib/api-hooks';
import type { AdminRole } from '@/lib/auth';

export function ReferralsClient({ role }: { role: AdminRole }) {
  const t = useTranslations('referrals');
  const isOperator = role === 'operator' || role === 'superadmin';

  const [targetWallet, setTargetWallet] = React.useState('');
  const [codeCount, setCodeCount] = React.useState(1);
  const [quotaWallet, setQuotaWallet] = React.useState('');
  const [quotaMax, setQuotaMax] = React.useState(10);
  const [increaseAmount, setIncreaseAmount] = React.useState(5);

  const generate = useAdminGenerateReferralCodes();
  const setQuota = useSetReferralQuota();
  const increaseQuota = useIncreaseReferralQuota();

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{t('heading')}</h1>
        <p className="text-sm text-muted-foreground">{t('subheading')}</p>
      </header>

      {isOperator ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t('generateTitle')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="target-wallet">{t('targetWallet')}</Label>
                <Input
                  id="target-wallet"
                  value={targetWallet}
                  onChange={(e) => setTargetWallet(e.target.value)}
                  placeholder={t('walletPlaceholder')}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="code-count">{t('codeCount')}</Label>
                <Input
                  id="code-count"
                  type="number"
                  min={1}
                  max={100}
                  value={codeCount}
                  onChange={(e) => setCodeCount(Number(e.target.value))}
                />
              </div>
              <Button
                disabled={!targetWallet || generate.isPending}
                onClick={() =>
                  generate.mutate({ targetWalletAddress: targetWallet, count: codeCount })
                }
              >
                {generate.isPending ? t('generating') : t('generate')}
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t('setQuotaTitle')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="quota-wallet">{t('wallet')}</Label>
                <Input
                  id="quota-wallet"
                  value={quotaWallet}
                  onChange={(e) => setQuotaWallet(e.target.value)}
                  placeholder={t('walletPlaceholder')}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="quota-max">{t('maxCodes')}</Label>
                <Input
                  id="quota-max"
                  type="number"
                  min={0}
                  value={quotaMax}
                  onChange={(e) => setQuotaMax(Number(e.target.value))}
                />
              </div>
              <Button
                disabled={!quotaWallet || setQuota.isPending}
                onClick={() => setQuota.mutate({ walletAddress: quotaWallet, maxCodes: quotaMax })}
              >
                {setQuota.isPending ? t('saving') : t('save')}
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t('increaseQuotaTitle')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="inc-wallet">{t('wallet')}</Label>
                <Input
                  id="inc-wallet"
                  value={quotaWallet}
                  onChange={(e) => setQuotaWallet(e.target.value)}
                  placeholder={t('walletPlaceholder')}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="inc-amount">{t('increaseAmount')}</Label>
                <Input
                  id="inc-amount"
                  type="number"
                  min={1}
                  value={increaseAmount}
                  onChange={(e) => setIncreaseAmount(Number(e.target.value))}
                />
              </div>
              <Button
                disabled={!quotaWallet || increaseQuota.isPending}
                onClick={() =>
                  increaseQuota.mutate({ walletAddress: quotaWallet, amount: increaseAmount })
                }
              >
                {increaseQuota.isPending ? t('saving') : t('increase')}
              </Button>
            </CardContent>
          </Card>
        </div>
      ) : (
        <Card>
          <CardContent className="py-6">
            <p className="text-sm text-muted-foreground">{t('readOnlyHint')}</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
