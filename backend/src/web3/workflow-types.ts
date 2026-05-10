/**
 * 節點執行數據結構（類似 n8n 的 INodeExecutionData）
 */
export interface NodeExecutionData {
  json: Record<string, any>;
  binary?: Record<string, any>;
}

/**
 * Optional surface for nodes whose execution is delegated to an on-chain
 * Anchor program. When the strategy compiler classifies a node as
 * `native_anchor_program`, the keeper calls `buildOnchainInstruction(...)`
 * on the registered node implementation and submits the returned
 * instruction via `OnchainAdapterPort.submitNodeInstruction()` instead of
 * running the off-chain `execute()` handler.
 *
 * Decoupled from `@solana/web3.js` to avoid leaking Solana types into the
 * core node interface — the keeper handles serialisation.
 */
export interface OnchainInstructionAccountMeta {
  pubkey: string;
  isSigner: boolean;
  isWritable: boolean;
}

export interface OnchainInstructionPayload {
  programId: string;
  /** Account metas in the same order the on-chain handler expects. */
  accounts: OnchainInstructionAccountMeta[];
  /** Raw instruction data (discriminator + serialised args), base64-encoded. */
  dataBase64: string;
}

/**
 * 節點類型接口（類似 n8n 的 INodeType）
 */
export interface INodeType {
  description: INodeDescription;
  execute(context: IExecuteContext): Promise<NodeExecutionData[][]>;

  /**
   * Optional. When present, the node is backed by an on-chain Anchor
   * program — the keeper builds + submits the returned instruction instead
   * of calling `execute()`. See `INodeType.execute` doc for the off-chain
   * fallback path.
   */
  buildOnchainInstruction?(context: IExecuteContext): Promise<{
    instruction: OnchainInstructionPayload;
    explanation: string;
  }>;
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
  isTrigger?: boolean;
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
  /**
   * Whether this parameter is creator-private. The strategy compiler
   * UNIONs node-declared `sensitive: true` properties with the global
   * SENSITIVE_PARAMETER_KEYS set when redacting the public view, so the
   * frontend renders a 🔒 next to it on the public Strategy Detail page.
   */
  sensitive?: boolean;
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
  abortSignal?: AbortSignal;
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
