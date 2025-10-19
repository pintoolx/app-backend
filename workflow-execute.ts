import {
  WorkflowDefinition,
  WorkflowNode,
  NodeConnection,
  INodeType,
  NodeExecutionData,
  IExecuteContext,
} from './web3-workflow-types';

/**
 * 執行數據接口
 */
interface IExecuteData {
  node: WorkflowNode;
  inputData: NodeExecutionData[];
  source: {
    main: Array<Array<{ node: string; index: number }>>;
  };
}

/**
 * Workflow 執行引擎（類似 n8n 的 WorkflowExecute）
 */
export class WorkflowExecute {
  private workflow: WorkflowDefinition;
  private nodeTypes: Map<string, INodeType>;
  private staticData: Record<string, any>;
  private runData: Map<string, NodeExecutionData[][]>;
  private nodeExecutionStack: IExecuteData[];

  constructor(
    workflow: WorkflowDefinition,
    nodeTypes: Map<string, INodeType>,
    staticData: Record<string, any> = {}
  ) {
    this.workflow = workflow;
    this.nodeTypes = nodeTypes;
    this.staticData = staticData;
    this.runData = new Map();
    this.nodeExecutionStack = [];
  }

  /**
   * 執行整個 workflow
   */
  async run(): Promise<Map<string, NodeExecutionData[][]>> {
    console.log(' Starting workflow execution...');

    // 找到起始節點（沒有輸入的節點）
    const startNodes = this.workflow.nodes.filter((node) => {
      const nodeDesc = this.nodeTypes.get(node.type)?.description;
      return nodeDesc?.inputs.length === 0;
    });

    if (startNodes.length === 0) {
      throw new Error('No start node found in workflow');
    }

    // 初始化執行堆棧
    for (const startNode of startNodes) {
      this.nodeExecutionStack.push({
        node: startNode,
        inputData: [],
        source: { main: [] },
      });
    }

    // 主執行循環
    while (this.nodeExecutionStack.length > 0) {
      const executeData = this.nodeExecutionStack.shift()!;
      await this.executeNode(executeData);
    }

    console.log('✅ Workflow execution completed');
    return this.runData;
  }

  /**
   * 執行單個節點
   */
  private async executeNode(executeData: IExecuteData): Promise<void> {
    const { node, inputData } = executeData;
    console.log(`\n📦 Executing node: ${node.name} (${node.type})`);

    const nodeType = this.nodeTypes.get(node.type);
    if (!nodeType) {
      throw new Error(`Node type not found: ${node.type}`);
    }

    // 創建執行上下文
    const context: IExecuteContext = {
      getNodeParameter: (parameterName: string, itemIndex: number, defaultValue?: any) => {
        return node.parameters[parameterName] ?? defaultValue;
      },
      getInputData: (inputIndex: number = 0) => {
        return inputData;
      },
      getWorkflowStaticData: (type: string) => {
        return this.staticData;
      },
      helpers: {
        returnJsonArray: (jsonData: any[]) => {
          return [jsonData.map((item) => ({ json: item }))];
        },
      },
    };

    try {
      // 執行節點
      const outputData = await nodeType.execute(context);
      this.runData.set(node.name, outputData);

      console.log(`   ✓ Output:`, JSON.stringify(outputData[0], null, 2));

      // 添加下游節點到執行堆棧
      this.addDownstreamNodes(node, outputData);
    } catch (error) {
      console.error(`   ✗ Error in node ${node.name}:`, error);
      throw error;
    }
  }

  /**
   * 添加下游節點到執行堆棧
   */
  private addDownstreamNodes(
    sourceNode: WorkflowNode,
    outputData: NodeExecutionData[][]
  ): void {
    const connections = this.workflow.connections[sourceNode.name];
    if (!connections || !connections.main) {
      return;
    }

    // 遍歷所有輸出連接
    for (let outputIndex = 0; outputIndex < connections.main.length; outputIndex++) {
      const outputConnections = connections.main[outputIndex];

      for (const connection of outputConnections) {
        const targetNode = this.workflow.nodes.find((n) => n.name === connection.node);
        if (!targetNode) {
          console.warn(`Target node not found: ${connection.node}`);
          continue;
        }

        // 將下游節點添加到執行堆棧
        this.nodeExecutionStack.push({
          node: targetNode,
          inputData: outputData[outputIndex] || [],
          source: {
            main: [[{ node: sourceNode.name, index: outputIndex }]],
          },
        });

        console.log(`   → Queued downstream node: ${targetNode.name}`);
      }
    }
  }

  /**
   * 獲取節點的執行結果
   */
  getNodeResult(nodeName: string): NodeExecutionData[][] | undefined {
    return this.runData.get(nodeName);
  }

  /**
   * 獲取所有執行結果
   */
  getAllResults(): Map<string, NodeExecutionData[][]> {
    return this.runData;
  }
}
