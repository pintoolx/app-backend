import { NextResponse, type NextRequest } from 'next/server';
import { COOKIE_NAMES, TTL_SECONDS, buildPublicCookieAttributes } from '@/lib/cookies';
import { normalizeLocale } from '@/i18n/config';

export async function POST(req: NextRequest) {
  let body: { locale?: string } = {};

  try {
    body = (await req.json()) as { locale?: string };
  } catch {
    return NextResponse.json({ success: false, message: 'Body must be JSON' }, { status: 400 });
  }

  const locale = normalizeLocale(body.locale);
  const res = NextResponse.json({ success: true, locale });

  res.cookies.set({
    name: COOKIE_NAMES.locale,
    value: locale,
    ...buildPublicCookieAttributes({ maxAgeSeconds: TTL_SECONDS.locale }),
  });

  return res;
}
