import { Module } from '@nestjs/common';
import { TelegramModule } from '../telegram/telegram.module';
import { CrossmintModule } from '../crossmint/crossmint.module';
import { Web3Module } from '../web3/web3.module';
import { WorkflowsController } from './workflows.controller';
import { WorkflowsService } from './workflows.service';

@Module({
  imports: [TelegramModule, CrossmintModule, Web3Module],
  controllers: [WorkflowsController],
  providers: [WorkflowsService],
  exports: [WorkflowsService],
})
export class WorkflowsModule {}
