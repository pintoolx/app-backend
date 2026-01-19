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
 * Workflow Executor 配置
 */
export interface WorkflowExecutorConfig {
  telegramNotifier?: TelegramNotifierService;
  workflowName?: string;
  chatId?: string;
  executionId?: string;
  // 服務注入
  crossmintService?: CrossmintService;
  agentKitService?: AgentKitService;
}

/**
 * Workflow 执行器
 */
export class WorkflowExecutor {
  private nodes: Map<string, INodeType> = new Map();
  private workflowData: Map<string, NodeExecutionData[][]> = new Map();
  private telegramNotifier?: TelegramNotifierService;
  private workflowName?: string;
  private chatId?: string;
  private executionId?: string;
  // 注入的服務
  private crossmintService?: CrossmintService;
  private agentKitService?: AgentKitService;

  constructor(config: WorkflowExecutorConfig = {}) {
    this.telegramNotifier = config.telegramNotifier;
    this.workflowName = config.workflowName;
    this.chatId = config.chatId;
    this.executionId = config.executionId;
    this.crossmintService = config.crossmintService;
    this.agentKitService = config.agentKitService;
  }

  /**
   * 注册节点类型
   * @param nodeType 节点名称
   * @param nodeClass 节点类
   */
  registerNodeType(nodeType: string, nodeClass: new () => INodeType) {
    const instance = new nodeClass();
    this.nodes.set(nodeType, instance);
  }

  /**
   * 执行 workflow
   * @param workflow Workflow 定义
   * @returns Promise<Map<string, NodeExecutionData[][]>> 所有节点的执行结果
   */
  async execute(workflow: WorkflowDefinition): Promise<Map<string, NodeExecutionData[][]>> {
    const startTime = Date.now();
    console.log('开始执行 Workflow...\n');

    // 发送 Workflow 开始通知
    if (this.telegramNotifier?.isEnabled && this.chatId && this.workflowName && this.executionId) {
      await this.telegramNotifier.sendWorkflowStartNotification(
        this.chatId,
        this.workflowName,
        this.executionId,
      );
    } else {
      // Fallback log
      console.log(`⚙️ Workflow started: ${this.workflowName}`);
    }

    // 清空之前的数据
    this.workflowData.clear();

    try {
      // 找到起始节点（没有输入连接的节点）
      const startNodes = this.findStartNodes(workflow);

      // 按拓扑顺序执行节点
      for (const nodeId of startNodes) {
        await this.executeNode(workflow, nodeId);
      }

      const duration = Date.now() - startTime;
      console.log(`\nWorkflow execution completed in ${duration}ms`);

      // 发送 Workflow 完成通知
      if (
        this.telegramNotifier?.isEnabled &&
        this.chatId &&
        this.workflowName &&
        this.executionId
      ) {
        await this.telegramNotifier.sendWorkflowCompleteNotification(
          this.chatId,
          this.workflowName,
          this.executionId,
        );
      } else {
        console.log(`✅ Workflow completed: ${workflow.nodes.length} nodes in ${duration}ms`);
      }

      return this.workflowData;
    } catch (error) {
      // 发送 Workflow 失败通知
      if (
        this.telegramNotifier?.isEnabled &&
        this.chatId &&
        this.workflowName &&
        this.executionId &&
        error instanceof Error
      ) {
        await this.telegramNotifier.sendWorkflowErrorNotification(
          this.chatId,
          this.workflowName,
          this.executionId,
          error.message,
        );
      } else {
        console.error(`❌ Workflow error:`, error);
      }
      throw error;
    }
  }

  /**
   * 执行单个节点
   */
  private async executeNode(workflow: WorkflowDefinition, nodeId: string): Promise<void> {
    // 如果已经执行过，跳过
    if (this.workflowData.has(nodeId)) {
      return;
    }

    const workflowNode = workflow.nodes.find((n) => n.id === nodeId);
    if (!workflowNode) {
      throw new Error(`Node ${nodeId} does not exist`);
    }

    console.log(`\n${'='.repeat(60)}`);
    console.log(`Execute node: ${workflowNode.name} (${workflowNode.type})`);
    console.log(`${'='.repeat(60)}`);

    const nodeType = this.nodes.get(workflowNode.type);
    if (!nodeType) {
      throw new Error(`Unregistered node type: ${workflowNode.type}`);
    }

    // 获取输入数据（从前置节点）
    const inputData = this.getInputDataForNode(workflow, nodeId);

    // 创建执行上下文
    const context: IExecuteContext = {
      getNodeParameter: (parameterName: string, itemIndex: number, defaultValue?: any) => {
        // 特殊參數：注入的服務
        if (parameterName === 'crossmintService') {
          return this.crossmintService;
        }
        if (parameterName === 'agentKitService') {
          return this.agentKitService;
        }

        const value = workflowNode.parameters[parameterName];
        return value !== undefined ? value : defaultValue;
      },
      getInputData: (inputIndex: number = 0) => {
        if (inputData.length === 0) {
          // 如果没有输入数据，返回一个空对象作为触发
          return [{ json: {} }];
        }
        return inputData[inputIndex] || [];
      },
      getWorkflowStaticData: (type: string) => {
        return {};
      },
      helpers: {
        returnJsonArray: (jsonData: any[]) => {
          return [jsonData.map((item) => ({ json: item }))];
        },
      },
    };

    // 执行节点
    try {
      const result = await nodeType.execute(context);
      this.workflowData.set(nodeId, result);

      // 打印执行结果
      console.log(`\nNode execution result:`);
      console.log(JSON.stringify(result, null, 2));

      // 检查是否需要发送 Telegram 通知
      // 优先级: workflow JSON 中的设置 > Node 类中的默认设置
      const shouldNotify =
        workflowNode.telegramNotify !== undefined
          ? workflowNode.telegramNotify
          : nodeType.description.telegramNotify;

      if (shouldNotify && this.telegramNotifier?.isEnabled && this.chatId) {
        await this.telegramNotifier.sendNodeExecutionNotification(
          this.chatId,
          workflowNode.name,
          workflowNode.type,
          result[0][0].json, // 发送第一个输出数组的第一个元素的数据
        );
      } else {
        console.log(`✅ Node executed: ${workflowNode.name} (${workflowNode.type})`);
      }

      // 执行后续节点
      const nextNodes = this.getNextNodes(workflow, nodeId);
      for (const nextNodeId of nextNodes) {
        await this.executeNode(workflow, nextNodeId);
      }
    } catch (error) {
      console.error(
        `\n❌ Node execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );

      // 发送节点失败通知 (Workflow level error handler will also catch this, but we might want granular notification here if needed)
      // For now, we rely on the workflow level catch block to send the final error notification.
      // But if we want to notify about specific node failure before bubbling up:
      /*
      if (this.telegramNotifier?.isEnabled && this.chatId && error instanceof Error) {
         // Optional: Send specific node error
      }
      */

      throw error;
    }
  }

  /**
   * 查找起始节点
   */
  private findStartNodes(workflow: WorkflowDefinition): string[] {
    const allNodes = new Set(workflow.nodes.map((n) => n.id));
    const hasInput = new Set<string>();

    // 遍历所有连接，找出有输入的节点
    for (const [nodeId, connections] of Object.entries(workflow.connections)) {
      if (connections.main) {
        for (const connectionGroup of connections.main) {
          for (const connection of connectionGroup) {
            hasInput.add(connection.node);
          }
        }
      }
    }

    // 返回没有输入的节点（起始节点）
    return Array.from(allNodes).filter((nodeId) => !hasInput.has(nodeId));
  }

  /**
   * 获取节点的输入数据
   */
  private getInputDataForNode(workflow: WorkflowDefinition, nodeId: string): NodeExecutionData[][] {
    const inputData: NodeExecutionData[][] = [];

    // 遍历所有连接，找到指向当前节点的连接
    for (const [sourceNodeId, connections] of Object.entries(workflow.connections)) {
      if (connections.main) {
        for (const connectionGroup of connections.main) {
          for (const connection of connectionGroup) {
            if (connection.node === nodeId) {
              // 获取源节点的输出数据
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

  /**
   * 获取下一个要执行的节点
   */
  private getNextNodes(workflow: WorkflowDefinition, nodeId: string): string[] {
    const connections = workflow.connections[nodeId];
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
