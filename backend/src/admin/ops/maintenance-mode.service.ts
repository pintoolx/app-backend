import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../../database/supabase.service';

const SYSTEM_CONFIG_KEY = 'maintenance_mode';

export interface MaintenanceState {
  enabled: boolean;
  message: string | null;
  startedAt: string | null;
  startedBy: string | null;
}

const DISABLED: MaintenanceState = {
  enabled: false,
  message: null,
  startedAt: null,
  startedBy: null,
};

/**
 * Reads / writes the `maintenance_mode` system_config row.
 *
 * Caches the value for 5 seconds so the per-request guard does not flood
 * Supabase. The cache TTL is short enough that turning maintenance mode on
 * via the admin UI propagates within a few seconds — long enough to deflect
 * traffic spikes during cutovers.
 */
@Injectable()
export class MaintenanceModeService {
  private readonly logger = new Logger(MaintenanceModeService.name);
  private cache: { value: MaintenanceState; expiresAt: number } | null = null;
  private static readonly CACHE_MS = 5_000;

  constructor(private readonly supabaseService: SupabaseService) {}

  async getState(): Promise<MaintenanceState> {
    if (this.cache && this.cache.expiresAt > Date.now()) return this.cache.value;
    const { data, error } = await this.supabaseService.client
      .from('system_config')
      .select('value')
      .eq('key', SYSTEM_CONFIG_KEY)
      .maybeSingle();
    if (error) {
      this.logger.warn(`maintenance_mode lookup failed: ${error.message}`);
      this.cache = { value: DISABLED, expiresAt: Date.now() + MaintenanceModeService.CACHE_MS };
      return DISABLED;
    }
    const parsed = parseValue(data?.value ?? null);
    this.cache = { value: parsed, expiresAt: Date.now() + MaintenanceModeService.CACHE_MS };
    return parsed;
  }

  async setState(input: {
    enabled: boolean;
    message: string | null;
    startedBy: string;
  }): Promise<MaintenanceState> {
    const next: MaintenanceState = {
      enabled: input.enabled,
      message: input.message,
      startedAt: input.enabled ? new Date().toISOString() : null,
      startedBy: input.enabled ? input.startedBy : null,
    };
    const { error } = await this.supabaseService.client
      .from('system_config')
      .upsert({ key: SYSTEM_CONFIG_KEY, value: JSON.stringify(next) }, { onConflict: 'key' });
    if (error) {
      this.logger.error('Failed to upsert maintenance_mode', error);
      throw error;
    }
    this.cache = { value: next, expiresAt: Date.now() + MaintenanceModeService.CACHE_MS };
    return next;
  }

  /** Forcibly invalidates the in-process cache (useful in tests). */
  invalidate(): void {
    this.cache = null;
  }
}

function parseValue(raw: string | null): MaintenanceState {
  if (!raw) return DISABLED;
  try {
    const parsed = JSON.parse(raw) as Partial<MaintenanceState>;
    return {
      enabled: Boolean(parsed.enabled),
      message: typeof parsed.message === 'string' ? parsed.message : null,
      startedAt: typeof parsed.startedAt === 'string' ? parsed.startedAt : null,
      startedBy: typeof parsed.startedBy === 'string' ? parsed.startedBy : null,
    };
  } catch {
    // Legacy: a plain "true"/"false" string.
    if (raw.trim() === 'true')
      return { enabled: true, message: null, startedAt: null, startedBy: null };
    return DISABLED;
  }
}
