import { Injectable } from '@nestjs/common';
import { Counter } from 'prom-client';
import { MetricsService } from '../observability/metrics.service';

export type AdminActionStatus = 'success' | 'failure';

/**
 * Admin-specific Prometheus counters. Registered against the shared
 * `MetricsService` registry so they show up at /metrics alongside the
 * existing HTTP and adapter-level series.
 */
@Injectable()
export class AdminMetricsService {
  private readonly adminActionsTotal: Counter;
  private readonly adminLoginAttempts: Counter;

  constructor(private readonly metrics: MetricsService) {
    this.adminActionsTotal = new Counter({
      name: 'admin_actions_total',
      help: 'Total admin write actions, labelled by action name, role, and outcome.',
      labelNames: ['action', 'role', 'status'] as const,
      registers: [this.metrics.getRegistry()],
    });
    this.adminLoginAttempts = new Counter({
      name: 'admin_login_attempts_total',
      help: 'Admin login attempts, labelled by step and outcome.',
      labelNames: ['step', 'result'] as const,
      registers: [this.metrics.getRegistry()],
    });
  }

  recordAdminAction(action: string, role: string | null, status: AdminActionStatus): void {
    this.adminActionsTotal.inc({ action, role: role ?? 'unknown', status });
  }

  recordLoginAttempt(step: 'password' | 'totp' | 'refresh', result: 'success' | 'failure'): void {
    this.adminLoginAttempts.inc({ step, result });
  }
}
