import { SetMetadata } from '@nestjs/common';

export type StrategyRole = 'creator' | 'operator' | 'viewer' | 'subscriber' | 'auditor';

export const STRATEGY_ROLE_KEY = 'strategy_role';

/**
 * Decorator that marks an endpoint as requiring a specific strategy role.
 * Used together with StrategyPermissionGuard.
 *
 * Role hierarchy (from most to least privileged):
 *   creator > operator > viewer > subscriber > auditor
 */
export const RequireStrategyRole = (role: StrategyRole) =>
  SetMetadata(STRATEGY_ROLE_KEY, role);
