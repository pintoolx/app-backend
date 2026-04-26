import { cookies } from 'next/headers';
import { getRequestConfig } from 'next-intl/server';
import { COOKIE_NAMES } from '@/lib/cookies';
import { normalizeLocale } from './config';

const MESSAGES = {
  en: () => import('../messages/en.json').then((module) => module.default),
  'zh-TW': () => import('../messages/zh-TW.json').then((module) => module.default),
} as const;

export default getRequestConfig(async () => {
  const cookieStore = await cookies();
  const locale = normalizeLocale(cookieStore.get(COOKIE_NAMES.locale)?.value);

  return {
    locale,
    messages: await MESSAGES[locale](),
  };
});
