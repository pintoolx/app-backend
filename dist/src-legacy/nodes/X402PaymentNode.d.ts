import { type INodeType, type IExecuteContext, type NodeExecutionData } from "../web3-workflow-types";
/**
 * X402 Payment Node
 *
 * This node implements the x402 payment protocol for accessing paid content/APIs.
 * Flow:
 * 1. Requests content from target URL
 * 2. If 402 response, parses payment requirements
 * 3. Creates and signs Solana SPL Token transfer transaction
 * 4. Retries request with X-Payment header containing signed transaction
 * 5. Server validates and submits transaction, then returns content
 */
export declare class X402PaymentNode implements INodeType {
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
            options: {
                name: string;
                value: string;
            }[];
            default: string;
            description: string;
        })[];
    };
    execute(context: IExecuteContext): Promise<NodeExecutionData[][]>;
}
