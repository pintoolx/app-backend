import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import configuration from './config/configuration';
import { DatabaseModule } from './database/database.module';
import { CrossmintModule } from './crossmint/crossmint.module';
import { AuthModule } from './auth/auth.module';
import { WorkflowsModule } from './workflows/workflows.module';
import { TelegramModule } from './telegram/telegram.module';
import { Web3Module } from './web3/web3.module';
import { AgentModule } from './agent/agent.module';
import { AppController } from './app.controller';
import { RootController } from './root.controller';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
    }),
    DatabaseModule,
    CrossmintModule,
    AuthModule,
    WorkflowsModule,
    TelegramModule,
    Web3Module,
    AgentModule,
  ],
  controllers: [RootController, AppController],
})
export class AppModule {}
