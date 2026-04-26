import { NextResponse, type NextRequest } from 'next/server';
import { callBackend } from '@/lib/api';
import { COOKIE_NAMES, TTL_SECONDS, buildCookieAttributes } from '@/lib/cookies';

/**
 * Generic Bearer-attached proxy.
 *
 *   GET    /api/admin/proxy/admin/overview          → backend /admin/overview
 *   POST   /api/admin/proxy/admin/deployments/X/pause
 *
 * On 401 we attempt one silent refresh using the refresh cookie, set new
 * cookies via Set-Cookie, and replay the original request. A per-request
 * single-flight lock (Map<refresh,Promise>) deduplicates concurrent refresh
 * calls when multiple tabs/queries fire at once.
 */
const refreshInFlight = new Map<string, Promise<RefreshOutcome>>();

interface RefreshOutcome {
  ok: boolean;
  accessToken?: string;
  refreshToken?: string;
}

interface RefreshResponse {
  success: boolean;
  data?: { accessToken: string; refreshToken: string };
}

async function handle(
  req: NextRequest,
  ctx: { params: Promise<{ path: string[] }> },
): Promise<NextResponse> {
  const { path } = await ctx.params;
  const search = req.nextUrl.search;
  const upstreamPath = `/${path.join('/')}${search}`;
  if (!upstreamPath.startsWith('/admin/')) {
    return NextResponse.json(
      { success: false, message: 'Proxy only forwards /admin/* paths' },
      { status: 400 },
    );
  }

  const access = req.cookies.get(COOKIE_NAMES.access)?.value ?? null;
  const refresh = req.cookies.get(COOKIE_NAMES.refresh)?.value ?? null;
  const body = await readBody(req);

  let result = await callBackend(upstreamPath, {
    method: req.method,
    bearer: access,
    body,
  });

  let rotatedAccess: string | null = null;
  let rotatedRefresh: string | null = null;

  if (result.status === 401 && refresh) {
    const refreshed = await ensureRefresh(refresh);
    if (refreshed.ok && refreshed.accessToken && refreshed.refreshToken) {
      rotatedAccess = refreshed.accessToken;
      rotatedRefresh = refreshed.refreshToken;
      result = await callBackend(upstreamPath, {
        method: req.method,
        bearer: rotatedAccess,
        body,
      });
    }
  }

  // Build outgoing response, copying status + JSON body verbatim.
  const res = result.data
    ? NextResponse.json(result.data, { status: result.status })
    : new NextResponse(null, { status: result.status });

  if (rotatedAccess && rotatedRefresh) {
    res.cookies.set({
      name: COOKIE_NAMES.access,
      value: rotatedAccess,
      ...buildCookieAttributes({ maxAgeSeconds: TTL_SECONDS.access }),
    });
    res.cookies.set({
      name: COOKIE_NAMES.refresh,
      value: rotatedRefresh,
      ...buildCookieAttributes({ maxAgeSeconds: TTL_SECONDS.refresh }),
    });
  }

  if (result.status === 401 && !rotatedAccess) {
    // Sticky 401: the user must log in again. Wipe credentials so the next
    // page load gets bounced to /login by the middleware.
    res.cookies.delete(COOKIE_NAMES.access);
    res.cookies.delete(COOKIE_NAMES.refresh);
  }
  return res;
}

async function readBody(req: NextRequest): Promise<unknown> {
  if (req.method === 'GET' || req.method === 'HEAD') return undefined;
  const text = await req.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function ensureRefresh(refresh: string): Promise<RefreshOutcome> {
  const inflight = refreshInFlight.get(refresh);
  if (inflight) return inflight;
  const promise = (async (): Promise<RefreshOutcome> => {
    try {
      const r = await callBackend<RefreshResponse>('/admin/auth/refresh', {
        method: 'POST',
        body: { refreshToken: refresh },
      });
      if (!r.ok || !r.data?.data) return { ok: false };
      return {
        ok: true,
        accessToken: r.data.data.accessToken,
        refreshToken: r.data.data.refreshToken,
      };
    } finally {
      // Clear lock shortly after settle to allow follow-up refreshes if
      // the rotated token is also rejected.
      setTimeout(() => refreshInFlight.delete(refresh), 1000);
    }
  })();
  refreshInFlight.set(refresh, promise);
  return promise;
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
