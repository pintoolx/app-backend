import { ConsoleLogger, LoggerService } from '@nestjs/common';

/**
 * Week 6.3 — Structured JSON logger.
 *
 * Used in production / when `LOG_FORMAT=json`. In development we still want
 * pretty colors, so this falls back to ConsoleLogger if `LOG_FORMAT` is
 * anything other than 'json'.
 */
export class JsonLogger extends ConsoleLogger implements LoggerService {
  log(message: unknown, ...optional: unknown[]) {
    this.emit('log', message, optional);
  }
  error(message: unknown, ...optional: unknown[]) {
    this.emit('error', message, optional);
  }
  warn(message: unknown, ...optional: unknown[]) {
    this.emit('warn', message, optional);
  }
  debug(message: unknown, ...optional: unknown[]) {
    this.emit('debug', message, optional);
  }
  verbose(message: unknown, ...optional: unknown[]) {
    this.emit('verbose', message, optional);
  }

  private emit(level: string, message: unknown, optional: unknown[]) {
    const ctx = optional.length > 0 ? String(optional[optional.length - 1]) : undefined;
    const line = {
      ts: new Date().toISOString(),
      level,
      ctx,
      msg: typeof message === 'string' ? message : JSON.stringify(message),
    };
    process.stdout.write(JSON.stringify(line) + '\n');
  }
}

export function makeLogger(): LoggerService {
  if ((process.env.LOG_FORMAT ?? '').toLowerCase() === 'json') {
    return new JsonLogger();
  }
  return new ConsoleLogger();
}
