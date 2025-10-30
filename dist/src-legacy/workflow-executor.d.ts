import { type WorkflowDefinition, type INodeType, type NodeExecutionData } from './web3-workflow-types';
import { type TelegramNotifier } from './telegram-notifier';
/**
 * Workflow 执行器
 */
export declare class WorkflowExecutor {
    private nodes;
    private workflowData;
    private telegramNotifier?;
    private workflowName?;
    constructor(telegramNotifier?: TelegramNotifier, workflowName?: string);
    /**
     * 注册节点类型
     * @param nodeType 节点名称
     * @param nodeClass 节点类
     */
    registerNodeType(nodeType: string, nodeClass: new () => INodeType): void;
    /**
     * 执行 workflow
     * @param workflow Workflow 定义
     * @returns Promise<Map<string, NodeExecutionData[][]>> 所有节点的执行结果
     */
    execute(workflow: WorkflowDefinition): Promise<Map<string, NodeExecutionData[][]>>;
    /**
     * 执行单个节点
     */
    private executeNode;
    /**
     * 查找起始节点
     */
    private findStartNodes;
    /**
     * 获取节点的输入数据
     */
    private getInputDataForNode;
    /**
     * 获取下一个要执行的节点
     */
    private getNextNodes;
}
