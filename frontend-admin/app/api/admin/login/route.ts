import { NextResponse, type NextRequest } from 'next/server';
import { callBackend } from '@/lib/api';
import { COOKIE_NAMES, TTL_SECONDS, buildCookieAttributes } from '@/lib/cookies';

interface LoginResponse {
  success: boolean;
  data?: { tempToken: string; expiresInSec: number; step: 'totp_required' };
  message?: string;
}

/**
 * Step 1 of the admin login flow.
 * Forwards email + password to the backend; on success stashes the
 * 5-minute `tempToken` in an httpOnly cookie and instructs the client to
 * navigate to the TOTP page.
 */
export async function POST(req: NextRequest) {
  let body: { email?: string; password?: string } = {};
  try {
    body = (await req.json()) as { email?: string; password?: string };
  } catch {
    return NextResponse.json({ success: false, message: 'Body must be JSON' }, { status: 400 });
  }
  if (!body.email || !body.password) {
    return NextResponse.json(
      { success: false, message: 'email + password required' },
      { status: 400 },
    );
  }

  const result = await callBackend<LoginResponse>('/admin/auth/login', {
    method: 'POST',
    body: { email: body.email, password: body.password },
  });

  if (!result.ok || !result.data?.data?.tempToken) {
    return NextResponse.json(
      { success: false, message: extractMessage(result.data) || 'Login failed' },
      { status: result.status || 401 },
    );
  }

  const res = NextResponse.json({ success: true, step: 'totp_required' });
  res.cookies.set({
    name: COOKIE_NAMES.temp,
    value: result.data.data.tempToken,
    ...buildCookieAttributes({ maxAgeSeconds: TTL_SECONDS.temp }),
  });
  return res;
}

function extractMessage(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const m = (value as { message?: unknown }).message;
  return typeof m === 'string' ? m : null;
}
