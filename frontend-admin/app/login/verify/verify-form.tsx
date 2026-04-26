'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

const schema = z.object({
  totpCode: z
    .string()
    .regex(/^\d{6}$/, 'Enter the 6-digit code from your authenticator'),
});

type FormValues = z.infer<typeof schema>;

export function VerifyForm() {
  const t = useTranslations('login');
  const router = useRouter();

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    setValue,
  } = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: { totpCode: '' } });

  async function onSubmit(values: FormValues) {
    const r = await fetch('/api/admin/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(values),
    });
    const body: { success?: boolean; message?: string } = await r.json().catch(() => ({}));
    if (!r.ok || !body.success) {
      toast.error(body.message ?? `${t('verificationFailed')} (${r.status})`);
      setValue('totpCode', '', { shouldValidate: false });
      return;
    }
    router.push('/overview');
    router.refresh();
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle id="verify-title">{t('twoFactor')}</CardTitle>
        <CardDescription>{t('twoFactorHint')}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
          <div className="space-y-2">
            <Label htmlFor="totp">{t('totp')}</Label>
            <Input
              id="totp"
              type="text"
              inputMode="numeric"
              maxLength={6}
              autoComplete="one-time-code"
              autoFocus
              aria-invalid={Boolean(errors.totpCode)}
              aria-describedby={errors.totpCode ? 'totp-error' : undefined}
              {...register('totpCode')}
            />
            {errors.totpCode ? (
              <p id="totp-error" className="text-sm text-destructive">
                {errors.totpCode.message}
              </p>
            ) : null}
          </div>
          <Button type="submit" className="w-full" disabled={isSubmitting}>
            {isSubmitting ? t('verifying') : t('verify')}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
