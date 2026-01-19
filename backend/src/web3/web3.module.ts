import { Module } from '@nestjs/common';
import { ConnectionService } from './services/connection.service';
import { AgentKitService } from './services/agent-kit.service';
import { DatabaseModule } from '../database/database.module';
import { CrossmintModule } from '../crossmint/crossmint.module';

@Module({
  imports: [DatabaseModule, CrossmintModule],
  providers: [ConnectionService, AgentKitService],
  exports: [ConnectionService, AgentKitService],
})
export class Web3Module {}
