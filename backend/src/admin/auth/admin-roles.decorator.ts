import { SetMetadata } from '@nestjs/common';
import type { AdminRole } from './admin-users.repository';

export const ADMIN_ROLES_KEY = 'admin_roles';

/**
 * Marks an endpoint as requiring one of the listed admin roles. Use together
 * with `AdminJwtGuard` and `AdminRolesGuard`:
 *
 *   @UseGuards(AdminJwtGuard, AdminRolesGuard)
 *   @AdminRoles('operator', 'superadmin')
 *   pauseDeployment() {...}
 *
 * If the decorator is omitted on a guarded route, the default policy is
 * "authenticated admin only" (i.e. any active admin role passes).
 */
export const AdminRoles = (...roles: AdminRole[]) => SetMetadata(ADMIN_ROLES_KEY, roles);
