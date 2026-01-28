import {
  type WorkflowDefinition,
  type INodeType,
  type NodeExecutionData,
  type IExecuteContext,
} from '../web3/workflow-types';
import { TelegramNotifierService } from '../telegram/telegram-notifier.service';
import { CrossmintService } from '../crossmint/crossmint.service';
import { AgentKitService } from '../web3/services/agent-kit.service';

/**
 * Configuration for a single workflow instance execution
 */
export interface WorkflowInstanceConfig {
  workflowDefinition: WorkflowDefinition;
  executionId: string;
  workflowName: string;
  chatId?: string;
  // Injected Services
  telegramNotifier?: TelegramNotifierService;
  crossmintService?: CrossmintService;
  agentKitService?: AgentKitService;
  // Account Information
  accountId?: string;
  ownerWalletAddress?: string;
  crossmintWalletAddress?: string; // The wallet ID specific to this account
}

/**
 * Represents a single execution session of a workflow.
 * Created by WorkflowExecutorFactory.
 */
export class WorkflowInstance {
  private nodes: Map<string, INodeType> = new Map();
  private workflowData: Map<string, NodeExecutionData[][]> = new Map();

  // Configuration & Context
  public readonly executionId: string;
  private workflowDefinition: WorkflowDefinition;
  private workflowName: string;
  private chatId?: string;
  private telegramNotifier?: TelegramNotifierService;
  private crossmintService?: CrossmintService;
  private agentKitService?: AgentKitService;
  private crossmintWalletAddress?: string;
  private executionLogs: any[] = [];

  constructor(config: WorkflowInstanceConfig) {
    this.workflowDefinition = config.workflowDefinition;
    this.executionId = config.executionId;
    this.workflowName = config.workflowName;
    this.chatId = config.chatId;

    // Injected Services
    this.telegramNotifier = config.telegramNotifier;
    this.crossmintService = config.crossmintService;
    this.agentKitService = config.agentKitService;
    this.crossmintWalletAddress = config.crossmintWalletAddress;
  }

  /**
   * Get the structured execution logs
   */
  getExecutionLogs() {
    return this.executionLogs;
  }

  /**
   * Register a node type instance for this execution
   */
  registerNodeType(nodeType: string, instance: INodeType) {
    this.nodes.set(nodeType, instance);
  }

  /**
   * Execute the workflow
   */
  async execute(): Promise<Map<string, NodeExecutionData[][]>> {
    const startTime = Date.now();
    console.log(`[Instance ${this.executionId}] Starting workflow: ${this.workflowName}`);

    // Send Start Notification
    if (this.telegramNotifier?.isEnabled && this.chatId) {
      await this.telegramNotifier.sendWorkflowStartNotification(
        this.chatId,
        this.workflowName,
        this.executionId,
      );
    }

    this.workflowData.clear();

    try {
      const startNodes = this.findStartNodes(this.workflowDefinition);

      for (const nodeId of startNodes) {
        await this.executeNode(nodeId);
      }

      const duration = Date.now() - startTime;
      console.log(`[Instance ${this.executionId}] Completed in ${duration}ms`);

      // Send Completion Notification
      if (this.telegramNotifier?.isEnabled && this.chatId) {
        await this.telegramNotifier.sendWorkflowCompleteNotification(
          this.chatId,
          this.workflowName,
          this.executionId,
        );
      } else {
        console.log(`✅ Workflow completed: ${this.workflowDefinition.nodes.length} nodes`);
      }

      return this.workflowData;
    } catch (error) {
      console.error(`[Instance ${this.executionId}] Error:`, error);

      // Send Error Notification
      if (this.telegramNotifier?.isEnabled && this.chatId && error instanceof Error) {
        await this.telegramNotifier.sendWorkflowErrorNotification(
          this.chatId,
          this.workflowName,
          this.executionId,
          error.message,
        );
      }
      throw error;
    }
  }

  /**
   * Stop/Cleanup the instance (if needed for polling management)
   */
  stop() {
    console.log(`[Instance ${this.executionId}] Stopping/Cleaning up...`);
    // Implement any cleanup logic if nodes have long-running processes
  }

  private async executeNode(nodeId: string): Promise<void> {
    if (this.workflowData.has(nodeId)) {
      return;
    }

    const workflowNode = this.workflowDefinition.nodes.find((n) => n.id === nodeId);
    if (!workflowNode) {
      throw new Error(`Node ${nodeId} does not exist`);
    }

    console.log(
      `[Instance ${this.executionId}] Executing node: ${workflowNode.name} (${workflowNode.type})`,
    );

    const nodeType = this.nodes.get(workflowNode.type);
    if (!nodeType) {
      throw new Error(`Unregistered node type: ${workflowNode.type}`);
    }

    const inputData = this.getInputDataForNode(nodeId);
    const startTime = Date.now();

    const context: IExecuteContext = {
      getNodeParameter: (parameterName: string, itemIndex: number, defaultValue?: any) => {
        // Inject specific wallet address if requested (e.g. for automatic assignment)
        if (parameterName === 'walletAddress' && this.crossmintWalletAddress) {
          return this.crossmintWalletAddress;
        }

        // Service Injection
        if (parameterName === 'crossmintService') return this.crossmintService;
        if (parameterName === 'agentKitService') return this.agentKitService;

        const value = workflowNode.parameters[parameterName];
        return value !== undefined ? value : defaultValue;
      },
      getInputData: (inputIndex: number = 0) => {
        if (inputData.length === 0) {
          return [{ json: {} }];
        }
        return inputData[inputIndex] || [];
      },
      getWorkflowStaticData: (_type: string) => ({}),
      helpers: {
        returnJsonArray: (jsonData: any[]) => [jsonData.map((item) => ({ json: item }))],
      },
    };

    const stepLog: any = {
      nodeId,
      nodeName: workflowNode.name,
      nodeType: workflowNode.type,
      startedAt: new Date().toISOString(),
      input: context.getInputData(0)[0]?.json || {},
    };

    try {
      const result = await nodeType.execute(context);
      this.workflowData.set(nodeId, result);

      const endTime = Date.now();
      stepLog.status = 'completed';
      stepLog.durationMs = endTime - startTime; // Use node-specific start time
      stepLog.output = result[0]?.[0]?.json || {};
      this.executionLogs.push(stepLog);

      // Notification Check
      const shouldNotify = workflowNode.telegramNotify ?? nodeType.description.telegramNotify;

      if (shouldNotify && this.telegramNotifier?.isEnabled && this.chatId) {
        await this.telegramNotifier.sendNodeExecutionNotification(
          this.chatId,
          workflowNode.name,
          workflowNode.type,
          result[0]?.[0]?.json,
        );
      }

      // Execute Next Nodes
      const nextNodes = this.getNextNodes(nodeId);
      for (const nextNodeId of nextNodes) {
        await this.executeNode(nextNodeId);
      }
    } catch (error) {
      console.error(`[Instance ${this.executionId}] Node ${workflowNode.name} failed`);
      stepLog.status = 'failed';
      stepLog.durationMs = Date.now() - startTime; // Use node-specific start time
      stepLog.error = error instanceof Error ? error.message : 'Unknown error';
      this.executionLogs.push(stepLog);
      throw error;
    }
  }

  private findStartNodes(workflow: WorkflowDefinition): string[] {
    const allNodes = new Set(workflow.nodes.map((n) => n.id));
    const hasInput = new Set<string>();

    for (const [, connections] of Object.entries(workflow.connections)) {
      if (connections.main) {
        for (const connectionGroup of connections.main) {
          for (const connection of connectionGroup) {
            hasInput.add(connection.node);
          }
        }
      }
    }

    return Array.from(allNodes).filter((nodeId) => !hasInput.has(nodeId));
  }

  private getInputDataForNode(nodeId: string): NodeExecutionData[][] {
    const inputData: NodeExecutionData[][] = [];

    for (const [sourceNodeId, connections] of Object.entries(this.workflowDefinition.connections)) {
      if (connections.main) {
        for (const connectionGroup of connections.main) {
          for (const connection of connectionGroup) {
            if (connection.node === nodeId) {
              const sourceData = this.workflowData.get(sourceNodeId);
              if (sourceData) {
                inputData.push(...sourceData);
              }
            }
          }
        }
      }
    }

    return inputData;
  }

  private getNextNodes(nodeId: string): string[] {
    const connections = this.workflowDefinition.connections[nodeId];
    if (!connections || !connections.main) {
      return [];
    }

    const nextNodes: string[] = [];
    for (const connectionGroup of connections.main) {
      for (const connection of connectionGroup) {
        nextNodes.push(connection.node);
      }
    }

    return nextNodes;
  }
}
