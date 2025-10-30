import { type INodeType, type IExecuteContext, type NodeExecutionData } from '../web3-workflow-types';
export declare class PriceFeedNode implements INodeType {
    description: {
        displayName: string;
        name: string;
        group: string[];
        version: number;
        description: string;
        inputs: string[];
        outputs: string[];
        telegramNotify: boolean;
        properties: ({
            displayName: string;
            name: string;
            type: "string";
            default: string;
            description: string;
            options?: never;
        } | {
            displayName: string;
            name: string;
            type: "options";
            default: string;
            description: string;
            options: {
                name: string;
                value: string;
            }[];
        })[];
    };
    execute(context: IExecuteContext): Promise<NodeExecutionData[][]>;
}
