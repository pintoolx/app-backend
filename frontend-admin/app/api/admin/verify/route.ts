import { NextResponse, type NextRequest } from 'next/server';
import { callBackend } from '@/lib/api';
import { COOKIE_NAMES, TTL_SECONDS, buildCookieAttributes } from '@/lib/cookies';

interface SessionResponse {
  success: boolean;
  data?: {
    accessToken: string;
    refreshToken: string;
    expiresInSec: number;
    refreshExpiresAt: string;
    admin: { id: string; email: string; role: string };
  };
  message?: string;
}

/**
 * Step 2 of the admin login flow.
 * Reads the `admin_temp` cookie set by /api/admin/login, exchanges it
 * with the user-supplied 6-digit TOTP for an access + refresh session,
 * then sets two httpOnly cookies and clears the temp cookie.
 */
export async function POST(req: NextRequest) {
  const tempToken = req.cookies.get(COOKIE_NAMES.temp)?.value;
  if (!tempToken) {
    return NextResponse.json(
      { success: false, message: 'Temporary token expired or missing — log in again' },
      { status: 401 },
    );
  }

  let body: { totpCode?: string } = {};
  try {
    body = (await req.json()) as { totpCode?: string };
  } catch {
    return NextResponse.json({ success: false, message: 'Body must be JSON' }, { status: 400 });
  }
  if (!body.totpCode || !/^\d{6}$/.test(body.totpCode)) {
    return NextResponse.json(
      { success: false, message: 'totpCode must be 6 digits' },
      { status: 400 },
    );
  }

  const result = await callBackend<SessionResponse>('/admin/auth/2fa', {
    method: 'POST',
    body: { tempToken, totpCode: body.totpCode },
  });

  if (!result.ok || !result.data?.data) {
    return NextResponse.json(
      { success: false, message: extractMessage(result.data) || 'TOTP verification failed' },
      { status: result.status || 401 },
    );
  }

  const session = result.data.data;
  const res = NextResponse.json({ success: true, admin: session.admin });
  res.cookies.set({
    name: COOKIE_NAMES.access,
    value: session.accessToken,
    ...buildCookieAttributes({ maxAgeSeconds: TTL_SECONDS.access }),
  });
  res.cookies.set({
    name: COOKIE_NAMES.refresh,
    value: session.refreshToken,
    ...buildCookieAttributes({ maxAgeSeconds: TTL_SECONDS.refresh }),
  });
  res.cookies.delete(COOKIE_NAMES.temp);
  return res;
}

function extractMessage(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const m = (value as { message?: unknown }).message;
  return typeof m === 'string' ? m : null;
}
