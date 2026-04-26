import { NextResponse, type NextRequest } from 'next/server';
import { callBackend } from '@/lib/api';
import { COOKIE_NAMES } from '@/lib/cookies';

export async function POST(req: NextRequest) {
  const refresh = req.cookies.get(COOKIE_NAMES.refresh)?.value;
  if (refresh) {
    await callBackend('/admin/auth/logout', {
      method: 'POST',
      body: { refreshToken: refresh },
    }).catch(() => null);
  }
  const res = NextResponse.json({ success: true });
  res.cookies.delete(COOKIE_NAMES.access);
  res.cookies.delete(COOKIE_NAMES.refresh);
  res.cookies.delete(COOKIE_NAMES.temp);
  return res;
}
