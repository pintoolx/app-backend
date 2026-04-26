import { Module } from '@nestjs/common';
import { StrategyCompilerService } from './strategy-compiler.service';

@Module({
  providers: [StrategyCompilerService],
  exports: [StrategyCompilerService],
})
export class StrategyCompilerModule {}
