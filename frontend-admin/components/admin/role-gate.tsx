import * as React from 'react';
import { hasRole, type AdminClaims, type AdminRole } from '@/lib/auth';

export interface RoleGateProps {
  admin: AdminClaims | null;
  required: AdminRole;
  fallback?: React.ReactNode;
  children: React.ReactNode;
}

/**
 * Server component gate. Wrap any UI that should only show to operators
 * or superadmins. Returns `fallback` (default: nothing) when the user's
 * role is below the requirement. The backend re-enforces the same rule
 * via AdminRolesGuard, so this is purely a UX nicety.
 */
export function RoleGate({ admin, required, fallback = null, children }: RoleGateProps) {
  if (!hasRole(admin, required)) return <>{fallback}</>;
  return <>{children}</>;
}
