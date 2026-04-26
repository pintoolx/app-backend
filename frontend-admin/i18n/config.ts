import type { Locale } from 'date-fns';
import { enUS, zhTW } from 'date-fns/locale';

export const APP_LOCALES = ['en', 'zh-TW'] as const;

export type AppLocale = (typeof APP_LOCALES)[number];

export const DEFAULT_LOCALE: AppLocale = 'en';

export const DATE_FNS_LOCALES: Record<AppLocale, Locale> = {
  en: enUS,
  'zh-TW': zhTW,
};

export function isAppLocale(value: string | null | undefined): value is AppLocale {
  return APP_LOCALES.includes(value as AppLocale);
}

export function normalizeLocale(value: string | null | undefined): AppLocale {
  return isAppLocale(value) ? value : DEFAULT_LOCALE;
}
