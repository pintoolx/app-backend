/**
 * 節點執行數據結構（類似 n8n 的 INodeExecutionData）
 */
export interface NodeExecutionData {
  json: Record<string, any>;
  binary?: Record<string, any>;
}

/**
 * 節點類型接口（類似 n8n 的 INodeType）
 */
export interface INodeType {
  description: INodeDescription;
  execute(context: IExecuteContext): Promise<NodeExecutionData[][]>;
}

/**
 * 節點描述（類似 n8n 的 INodeTypeDescription）
 */
export interface INodeDescription {
  displayName: string;
  name: string;
  group: string[];
  version: number;
  description: string;
  inputs: string[];
  outputs: string[];
  telegramNotify: boolean;
  properties: INodeProperty[];
}

/**
 * 節點屬性配置
 */
export interface INodeProperty {
  displayName: string;
  name: string;
  type: 'string' | 'number' | 'boolean' | 'options';
  default: any;
  description: string;
  options?: Array<{ name: string; value: any }>;
}

/**
 * 執行上下文接口（類似 n8n 的 IExecuteFunctions）
 */
export interface IExecuteContext {
  getNodeParameter(parameterName: string, itemIndex: number, defaultValue?: any): any;
  getInputData(inputIndex?: number): NodeExecutionData[];
  getWorkflowStaticData(type: string): any;
  helpers: {
    returnJsonArray(jsonData: any[]): NodeExecutionData[][];
  };
}

/**
 * Workflow 節點定義
 */
export interface WorkflowNode {
  id: string;
  name: string;
  type: string;
  parameters: Record<string, any>;
  position?: [number, number];
  telegramNotify?: boolean; // 可选：是否为此节点发送 Telegram 通知
}

/**
 * 節點連接定義
 */
export interface NodeConnection {
  node: string;
  type: string;
  index: number;
}

/**
 * Workflow 定義
 */
export interface WorkflowDefinition {
  nodes: WorkflowNode[];
  connections: Record<
    string,
    {
      main: NodeConnection[][];
    }
  >;
}
