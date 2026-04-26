import { NextResponse, type NextRequest } from 'next/server';
import { COOKIE_NAMES } from './lib/cookies';

/**
 * Lightweight presence-check proxy (Next 16+ replacement for middleware.ts):
 *   - Anyone hitting an `(admin)` route without an access cookie is bounced
 *     to /login.
 *   - Authenticated users hitting /login are redirected straight to /overview.
 *
 * We deliberately do NOT verify the JWT here — the proxy runs in the Edge
 * runtime where pulling in `jose` adds bundle size. Server Components run
 * `getCurrentAdmin()` for the actual signature check (`lib/auth.ts`).
 */
export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const hasAccess = Boolean(req.cookies.get(COOKIE_NAMES.access));
  const hasTemp = Boolean(req.cookies.get(COOKIE_NAMES.temp));

  if (pathname === '/login' || pathname === '/login/verify') {
    if (hasAccess) {
      const url = req.nextUrl.clone();
      url.pathname = '/overview';
      return NextResponse.redirect(url);
    }
    if (pathname === '/login/verify' && !hasTemp) {
      const url = req.nextUrl.clone();
      url.pathname = '/login';
      return NextResponse.redirect(url);
    }
    return NextResponse.next();
  }

  if (pathname === '/' || pathname.startsWith('/api/')) {
    return NextResponse.next();
  }

  if (!hasAccess) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    // Run on every page, skip Next internals + static assets.
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|webp|ico)).*)',
  ],
};
