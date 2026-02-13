import { Injectable } from '@nestjs/common';
import { TelegramNotifierService } from '../telegram/telegram-notifier.service';
import { CrossmintService } from '../crossmint/crossmint.service';
import { AgentKitService } from '../web3/services/agent-kit.service';
import { WorkflowInstance, WorkflowInstanceConfig } from './workflow-instance';
import { getRegisteredNodes } from '../web3/nodes/node-registry';

@Injectable()
export class WorkflowExecutorFactory {
  constructor(
    private telegramNotifier: TelegramNotifierService,
    private crossmintService: CrossmintService,
    private agentKitService: AgentKitService,
  ) {}

  createInstance(
    config: Omit<
      WorkflowInstanceConfig,
      'telegramNotifier' | 'crossmintService' | 'agentKitService'
    >,
  ): WorkflowInstance {
    const fullConfig: WorkflowInstanceConfig = {
      ...config,
      telegramNotifier: this.telegramNotifier,
      crossmintService: this.crossmintService,
      agentKitService: this.agentKitService,
    };

    const instance = new WorkflowInstance(fullConfig);
    this.registerStandardNodes(instance);

    return instance;
  }

  private registerStandardNodes(instance: WorkflowInstance) {
    for (const [name, factory] of getRegisteredNodes()) {
      instance.registerNodeType(name, factory());
    }
  }
}
