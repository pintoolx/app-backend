import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { StrategyPermissionsService, StrategyRole } from '../strategy-permissions.service';
import { STRATEGY_ROLE_KEY } from '../decorators/require-strategy-role.decorator';

/**
 * Phase 3.1 — Strategy Permission Guard
 *
 * Protects endpoints that operate on a specific deployment.  Reads the
 * required role from the @RequireStrategyRole decorator and checks whether
 * the authenticated wallet has sufficient privileges.
 *
 * The deployment ID is resolved from:
 *   1. req.params.deploymentId
 *   2. req.params.id
 */
@Injectable()
export class StrategyPermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly permissionsService: StrategyPermissionsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredRole = this.reflector.getAllAndOverride<StrategyRole>(STRATEGY_ROLE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRole) {
      // No role requirement → allow through
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const walletAddress = request.user?.walletAddress as string | undefined;

    if (!walletAddress) {
      throw new ForbiddenException('Authentication required');
    }

    const deploymentId = this.resolveDeploymentId(request);
    if (!deploymentId) {
      throw new ForbiddenException('Deployment ID not found in request parameters');
    }

    const check = await this.permissionsService.checkPermission(
      deploymentId,
      walletAddress,
      requiredRole,
    );

    if (!check.allowed) {
      throw new ForbiddenException(
        `Insufficient permissions: required '${requiredRole}' but got '${check.actualRole ?? 'none'}'`,
      );
    }

    return true;
  }

  private resolveDeploymentId(request: any): string | undefined {
    return request.params?.deploymentId ?? request.params?.id ?? undefined;
  }
}
