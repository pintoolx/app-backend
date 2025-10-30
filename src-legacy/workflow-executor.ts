import { type WorkflowDefinition, type INodeType, type NodeExecutionData, type IExecuteContext } from './web3-workflow-types';
import { type TelegramNotifier } from './telegram-notifier';

/**
 * Workflow 执行器
 */
export class WorkflowExecutor {
  private nodes: Map<string, INodeType> = new Map();
  private workflowData: Map<string, NodeExecutionData[][]> = new Map();
  private telegramNotifier?: TelegramNotifier | undefined;
  private workflowName?: string | undefined;

  constructor(telegramNotifier?: TelegramNotifier, workflowName?: string) {
    this.telegramNotifier = telegramNotifier;
    this.workflowName = workflowName;
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
    if (this.telegramNotifier?.isEnabled()) {
      await this.telegramNotifier.sendWorkflowStart(this.workflowName);
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
      if (this.telegramNotifier?.isEnabled()) {
        await this.telegramNotifier.sendWorkflowComplete(workflow.nodes.length, duration);
      }

      return this.workflowData;
    } catch (error) {
      // 发送 Workflow 失败通知
      if (this.telegramNotifier?.isEnabled() && error instanceof Error) {
        await this.telegramNotifier.sendWorkflowError('Workflow', error);
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

    const workflowNode = workflow.nodes.find(n => n.id === nodeId);
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
      getNodeParameter: (parameterName: string, _itemIndex: number, defaultValue?: any) => {
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
      getWorkflowStaticData: (_type: string) => {
        return {};
      },
      helpers: {
        returnJsonArray: (jsonData: any[]) => {
          return [jsonData.map(item => ({ json: item }))];
        }
      }
    };

    // 执行节点
    try {
      const result = await nodeType.execute(context);
      this.workflowData.set(nodeId, result);

      // 驗證和打印执行结果
      console.log(`\n📤 Node execution result:`);
      if (result[0] && result[0][0]) {
        const firstItem = result[0][0].json;
        console.log(`   - success: ${firstItem['success']}`);
        console.log(`   - operation: ${firstItem['operation'] || 'N/A'}`);

        // 驗證標準化欄位
        if (firstItem['outputAmount'] !== undefined) {
          console.log(`   ✓ outputAmount: ${firstItem['outputAmount']}`);
        } else if (firstItem['amount'] !== undefined) {
          console.log(`   ⚠️  Using legacy 'amount' field: ${firstItem['amount']}`);
          console.log(`   ⚠️  Consider updating node to use 'outputAmount'`);
        }

        // 顯示完整結果（折疊）
        console.log(`\n   Full result:`);
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(JSON.stringify(result, null, 2));
      }

      // 检查是否需要发送 Telegram 通知
      // 优先级: workflow JSON 中的设置 > Node 类中的默认设置
      const shouldNotify = workflowNode.telegramNotify !== undefined
        ? workflowNode.telegramNotify
        : nodeType.description.telegramNotify;

      if (shouldNotify && this.telegramNotifier?.isEnabled()) {
        await this.telegramNotifier.sendNodeExecutionResult(
          workflowNode.name,
          workflowNode.type,
          result[0], // 发送第一个输出数组的数据
          true
        );
      }

      // 执行后续节点
      const nextNodes = this.getNextNodes(workflow, nodeId);
      for (const nextNodeId of nextNodes) {
        await this.executeNode(workflow, nextNodeId);
      }
    } catch (error) {
      console.error(`\n❌ Node execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`);

      // 发送节点失败通知
      if (this.telegramNotifier?.isEnabled() && error instanceof Error) {
        await this.telegramNotifier.sendWorkflowError(workflowNode.name, error);
      }

      throw error;
    }
  }

  /**
   * 查找起始节点
   */
  private findStartNodes(workflow: WorkflowDefinition): string[] {
    const allNodes = new Set(workflow.nodes.map(n => n.id));
    const hasInput = new Set<string>();

    // 遍历所有连接，找出有输入的节点
    for (const [_nodeId, connections] of Object.entries(workflow.connections)) {
      if (connections.main) {
        for (const connectionGroup of connections.main) {
          for (const connection of connectionGroup) {
            hasInput.add(connection.node);
          }
        }
      }
    }

    // 返回没有输入的节点（起始节点）
    return Array.from(allNodes).filter(nodeId => !hasInput.has(nodeId));
  }

  /**
   * 获取节点的输入数据（加入詳細日誌和驗證）
   */
  private getInputDataForNode(workflow: WorkflowDefinition, _nodeId: string): NodeExecutionData[][] {
    const inputData: NodeExecutionData[][] = [];
    const sourceNodes: string[] = [];

    // 遍历所有连接，找到指向当前节点的连接
    for (const [sourceNodeId, connections] of Object.entries(workflow.connections)) {
      if (connections.main) {
        for (const connectionGroup of connections.main) {
          for (const connection of connectionGroup) {
            if (connection.node === _nodeId) {
              // 获取源节点的输出数据
              const sourceData = this.workflowData.get(sourceNodeId);
              if (sourceData) {
                inputData.push(...sourceData);
                sourceNodes.push(sourceNodeId);

                // 記錄資料傳遞資訊
                console.log(`\n📥 Input from node "${sourceNodeId}":`);
                if (sourceData[0] && sourceData[0][0]) {
                  const firstItem = sourceData[0][0].json;
                  console.log(`   - success: ${firstItem['success']}`);
                  console.log(`   - operation: ${firstItem['operation'] || 'N/A'}`);

                  // 顯示金額相關欄位
                  if (firstItem['outputAmount'] !== undefined) {
                    console.log(`   - outputAmount: ${firstItem['outputAmount']}`);
                  }
                  if (firstItem['amount'] !== undefined) {
                    console.log(`   - amount: ${firstItem['amount']}`);
                  }

                  // 檢查資料完整性
                  if (!firstItem['success']) {
                    console.warn(`   ⚠️  Previous node reported failure!`);
                  }
                }
              } else {
                console.warn(`   ⚠️  Source node "${sourceNodeId}" has no output data`);
              }
            }
          }
        }
      }
    }

    if (sourceNodes.length === 0) {
      console.log(`\n📥 No input data (trigger node or start node)`);
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
