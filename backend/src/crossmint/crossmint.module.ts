import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CrossmintService } from './crossmint.service';
import { CrossmintController } from './crossmint.controller';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../database/database.module';
import { WorkflowsModule } from '../workflows/workflows.module';

@Module({
  imports: [ConfigModule, forwardRef(() => DatabaseModule), AuthModule, forwardRef(() => WorkflowsModule)],
  providers: [CrossmintService],
  controllers: [CrossmintController],
  exports: [CrossmintService],
})
export class CrossmintModule {}
