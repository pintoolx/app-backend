import { cookies } from 'next/headers';
import { jwtVerify, type JWTPayload } from 'jose';
import { COOKIE_NAMES } from './cookies';

export type AdminRole = 'viewer' | 'operator' | 'superadmin';

export interface AdminClaims {
  sub: string;
  email: string;
  role: AdminRole;
  scope: 'access';
  iat?: number;
  exp?: number;
}

const ROLE_RANK: Record<AdminRole, number> = {
  viewer: 0,
  operator: 1,
  superadmin: 2,
};

function getSecret(): Uint8Array | null {
  const secret = process.env.ADMIN_JWT_SECRET;
  if (!secret) return null;
  return new TextEncoder().encode(secret);
}

/**
 * Reads the admin_access cookie, verifies the HS256 signature, and returns
 * the typed claims. Returns null on any failure (missing cookie, expired,
 * wrong signature, secret not configured).
 *
 * The middleware already gates `/(admin)` routes by cookie presence — but we
 * verify here because the access cookie is HTTP-only and the only place
 * server components can read its claims.
 */
export async function getCurrentAdmin(): Promise<AdminClaims | null> {
  const secret = getSecret();
  if (!secret) return null;
  const store = await cookies();
  const token = store.get(COOKIE_NAMES.access)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret, { audience: 'admin' });
    if (!isAdminAccess(payload)) return null;
    return payload as unknown as AdminClaims;
  } catch {
    return null;
  }
}

/** Returns true when the active admin's role is at least the required one. */
export function hasRole(admin: AdminClaims | null, required: AdminRole): boolean {
  if (!admin) return false;
  return ROLE_RANK[admin.role] >= ROLE_RANK[required];
}

function isAdminAccess(payload: JWTPayload): boolean {
  return (
    typeof payload.sub === 'string' &&
    typeof (payload as { email?: unknown }).email === 'string' &&
    typeof (payload as { role?: unknown }).role === 'string' &&
    (payload as { scope?: unknown }).scope === 'access'
  );
}
