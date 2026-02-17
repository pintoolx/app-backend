import { Module } from '@nestjs/common';
import { AgentController } from './agent.controller';
import { AgentService } from './agent.service';
import { AuthModule } from '../auth/auth.module';
import { CrossmintModule } from '../crossmint/crossmint.module';
import { WorkflowsModule } from '../workflows/workflows.module';

@Module({
  imports: [AuthModule, CrossmintModule, WorkflowsModule],
  controllers: [AgentController],
  providers: [AgentService],
  exports: [AgentService],
})
export class AgentModule {}
