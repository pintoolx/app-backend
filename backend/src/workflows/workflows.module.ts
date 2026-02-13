import { Module } from '@nestjs/common';
import { TelegramModule } from '../telegram/telegram.module';
import { CrossmintModule } from '../crossmint/crossmint.module';
import { Web3Module } from '../web3/web3.module';
import { AuthModule } from '../auth/auth.module';
import { WorkflowsController } from './workflows.controller';
import { WorkflowsService } from './workflows.service';
import { WorkflowExecutorFactory } from './workflow-executor.factory';
import { WorkflowLifecycleManager } from './workflow-lifecycle.service';

@Module({
  imports: [TelegramModule, CrossmintModule, Web3Module, AuthModule],
  controllers: [WorkflowsController],
  providers: [WorkflowsService, WorkflowExecutorFactory, WorkflowLifecycleManager],
  exports: [WorkflowsService, WorkflowLifecycleManager],
})
export class WorkflowsModule {}
