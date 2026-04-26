import { Module } from '@nestjs/common';
import { WorkflowsModule } from '../workflows/workflows.module';
import { AuthModule } from '../auth/auth.module';
import { StrategiesModule } from '../strategies/strategies.module';
import { StrategyCompilerModule } from '../strategy-compiler/strategy-compiler.module';
import { WorkflowAiController } from './workflow-ai.controller';
import { WorkflowAiService } from './workflow-ai.service';
import { PromptBuilderService } from './prompt-builder.service';
import { ConversationStoreService } from './conversation-store.service';
import { WorkflowValidatorService } from './workflow-validator.service';

@Module({
  imports: [WorkflowsModule, AuthModule, StrategiesModule, StrategyCompilerModule],
  controllers: [WorkflowAiController],
  providers: [
    WorkflowAiService,
    PromptBuilderService,
    ConversationStoreService,
    WorkflowValidatorService,
  ],
})
export class WorkflowAiModule {}
