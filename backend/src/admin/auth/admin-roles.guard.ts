import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AdminAuthRequest } from './admin-jwt.guard';
import { ADMIN_ROLES_KEY } from './admin-roles.decorator';
import type { AdminRole } from './admin-users.repository';

const ROLE_RANK: Record<AdminRole, number> = {
  viewer: 0,
  operator: 1,
  superadmin: 2,
};

@Injectable()
export class AdminRolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<AdminRole[] | undefined>(ADMIN_ROLES_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    const req = ctx.switchToHttp().getRequest<AdminAuthRequest>();
    const role = req.admin?.role;
    if (!role) {
      throw new ForbiddenException('Admin role missing on request');
    }
    if (!required || required.length === 0) return true; // any active admin

    const userRank = ROLE_RANK[role];
    const minRequired = Math.min(...required.map((r) => ROLE_RANK[r]));
    if (userRank < minRequired) {
      throw new ForbiddenException(
        `Admin role '${role}' is not allowed (requires one of: ${required.join(', ')})`,
      );
    }
    return true;
  }
}
