/**
 * Cookie names + helpers for the admin BFF.
 *
 * In production the `__Host-` prefix forces Secure + same-origin and rejects
 * any cookie with a Domain attribute, eliminating an entire class of
 * subdomain-takeover bugs. In dev (HTTP, localhost) we drop the prefix so
 * browsers accept the cookie at all.
 */
const isProd = process.env.NODE_ENV === 'production';

const PREFIX = isProd ? '__Host-' : '';

export const COOKIE_NAMES = {
  temp: `${PREFIX}admin_temp`,
  access: `${PREFIX}admin_access`,
  refresh: `${PREFIX}admin_refresh`,
  locale: 'admin_locale',
} as const;

export type AdminCookieName = (typeof COOKIE_NAMES)[keyof typeof COOKIE_NAMES];

export interface CookieOptions {
  maxAgeSeconds: number;
}

/**
 * Returns the standard Set-Cookie attributes used by every admin cookie.
 * `path=/` is required when using the `__Host-` prefix.
 */
export function buildCookieAttributes({ maxAgeSeconds }: CookieOptions): {
  httpOnly: true;
  secure: boolean;
  sameSite: 'lax';
  path: '/';
  maxAge: number;
} {
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    path: '/',
    maxAge: maxAgeSeconds,
  };
}

export function buildPublicCookieAttributes({ maxAgeSeconds }: CookieOptions): {
  secure: boolean;
  sameSite: 'lax';
  path: '/';
  maxAge: number;
} {
  return {
    secure: isProd,
    sameSite: 'lax',
    path: '/',
    maxAge: maxAgeSeconds,
  };
}

export const TTL_SECONDS = {
  temp: 5 * 60,
  access: 15 * 60,
  refresh: 7 * 24 * 60 * 60,
  locale: 365 * 24 * 60 * 60,
} as const;
