import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Request } from 'express';
import { MaintenanceModeService } from './maintenance-mode.service';

/**
 * Returns 503 Service Unavailable for user-facing routes while
 * `system_config.maintenance_mode.enabled = true`.
 *
 * Always allowed (so admins can disable maintenance from the UI):
 *   - any /admin/* path
 *   - /health/*  &  /metrics  (probes / observability)
 *   - / (root)
 */
@Injectable()
export class MaintenanceModeGuard implements CanActivate {
  constructor(private readonly maintenance: MaintenanceModeService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request>();
    const url = (req.originalUrl || req.url || '').split('?')[0];

    if (
      url.startsWith('/admin/') ||
      url.startsWith('/health') ||
      url === '/metrics' ||
      url === '/'
    ) {
      return true;
    }

    const state = await this.maintenance.getState();
    if (!state.enabled) return true;

    throw new ServiceUnavailableException({
      statusCode: 503,
      error: 'MaintenanceMode',
      message: state.message ?? 'PinTool is undergoing maintenance. Please try again shortly.',
      startedAt: state.startedAt,
    });
  }
}
