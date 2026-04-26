import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { RuntimeConfigService } from './runtime-config.service';

/**
 * Week 6.5 — Wraps the {@link RuntimeConfigService} so it's globally
 * registered without polluting AppModule's providers list further.
 */
@Module({
  imports: [ConfigModule],
  providers: [RuntimeConfigService],
  exports: [RuntimeConfigService],
})
export class RuntimeConfigModule {}
