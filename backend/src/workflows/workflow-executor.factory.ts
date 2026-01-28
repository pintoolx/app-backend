import { Injectable } from '@nestjs/common';
import { TelegramNotifierService } from '../telegram/telegram-notifier.service';
import { CrossmintService } from '../crossmint/crossmint.service';
import { AgentKitService } from '../web3/services/agent-kit.service';
import { WorkflowInstance, WorkflowInstanceConfig } from './workflow-instance';
import { PriceFeedNode } from '../web3/nodes/price-feed.node';
import { SwapNode } from '../web3/nodes/swap.node';
import { KaminoNode } from '../web3/nodes/kamino.node';
import { TransferNode } from '../web3/nodes/transfer.node';
import { BalanceNode } from '../web3/nodes/balance.node';
import { LimitOrderNode } from '../web3/nodes/limit-order.node';

@Injectable()
export class WorkflowExecutorFactory {
  constructor(
    private telegramNotifier: TelegramNotifierService,
    private crossmintService: CrossmintService,
    private agentKitService: AgentKitService,
  ) {}

  /**
   * Create a new WorkflowInstance with injected services
   */
  createInstance(config: Omit<WorkflowInstanceConfig, 'telegramNotifier' | 'crossmintService' | 'agentKitService'>): WorkflowInstance {
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

  /**
   * Register standard available nodes to the instance
   */
  private registerStandardNodes(instance: WorkflowInstance) {
    instance.registerNodeType('pythPriceFeed', new PriceFeedNode());
    instance.registerNodeType('jupiterSwap', new SwapNode());
    instance.registerNodeType('kamino', new KaminoNode());
    instance.registerNodeType('transfer', new TransferNode());
    instance.registerNodeType('getBalance', new BalanceNode());
    instance.registerNodeType('jupiterLimitOrder', new LimitOrderNode());
  }
}
