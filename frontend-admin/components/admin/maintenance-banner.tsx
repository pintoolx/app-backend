'use client';

import { useTranslations } from 'next-intl';
import { AlertTriangle } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { proxyFetch } from '@/lib/proxy-fetch';

interface MaintenanceState {
  enabled: boolean;
  message: string | null;
  startedAt: string | null;
  startedBy: string | null;
}

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
}

/**
 * Polls /admin/system/maintenance every 60s and shows a banner whenever
 * the platform is in maintenance mode. Hidden when disabled or while the
 * very first request is still loading.
 */
export function MaintenanceBanner() {
  const t = useTranslations('maintenance');
  const tCommon = useTranslations('common');
  const { data } = useQuery({
    queryKey: ['admin', 'maintenance-banner'],
    queryFn: () =>
      proxyFetch<ApiEnvelope<MaintenanceState>>('/admin/system/maintenance'),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
  const state = data?.data;
  if (!state?.enabled) return null;

  return (
    <div
      className="flex items-start gap-2 border-b border-warning/40 bg-warning/10 px-4 py-2 text-sm text-[hsl(var(--warning))]"
      role="status"
      aria-live="polite"
    >
      <AlertTriangle className="mt-0.5 h-4 w-4" />
      <div className="flex-1">
        <p className="font-medium">{t('bannerTitle')}</p>
        <p className="text-muted-foreground">
          {state.message ?? t('bannerDefault')}
          {state.startedBy
            ? ` ${t('bannerStartedBy', { who: state.startedBy })}`
            : ` ${t('bannerStartedBy', { who: tCommon('unknown') })}`}
        </p>
      </div>
    </div>
  );
}
