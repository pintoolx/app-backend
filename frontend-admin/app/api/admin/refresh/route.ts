import { NextResponse, type NextRequest } from 'next/server';
import { callBackend } from '@/lib/api';
import { COOKIE_NAMES, TTL_SECONDS, buildCookieAttributes } from '@/lib/cookies';

interface RefreshResponse {
  success: boolean;
  data?: {
    accessToken: string;
    refreshToken: string;
    expiresInSec: number;
    admin: { id: string; email: string; role: string };
  };
  message?: string;
}

/**
 * Manual refresh trigger. The proxy route also auto-refreshes on 401, so the
 * UI rarely needs to call this directly — but it's exposed for explicit
 * "stay logged in" buttons or test harnesses.
 */
export async function POST(req: NextRequest) {
  const refresh = req.cookies.get(COOKIE_NAMES.refresh)?.value;
  if (!refresh) {
    return NextResponse.json(
      { success: false, message: 'No refresh cookie' },
      { status: 401 },
    );
  }
  const result = await callBackend<RefreshResponse>('/admin/auth/refresh', {
    method: 'POST',
    body: { refreshToken: refresh },
  });
  if (!result.ok || !result.data?.data) {
    const res = NextResponse.json(
      { success: false, message: extractMessage(result.data) || 'Refresh failed' },
      { status: result.status || 401 },
    );
    res.cookies.delete(COOKIE_NAMES.access);
    res.cookies.delete(COOKIE_NAMES.refresh);
    return res;
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
  return res;
}

function extractMessage(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const m = (value as { message?: unknown }).message;
  return typeof m === 'string' ? m : null;
}
