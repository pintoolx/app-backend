import { type INodeType, type IExecuteContext, type NodeExecutionData } from '../workflow-types';
import { X402ClientService } from '../services/x402-client.service';

/**
 * X402 Client Node
 *
 * Calls x402-protected APIs with automatic payment handling.
 * Uses faremeter client library to transparently handle 402 payment flow.
 * 
 * The node only needs:
 * - API URL to call
 * - Account to use for payment
 * - Network (optional)
 * 
 * Everything else (amount, recipient, token, etc.) is automatically
 * discovered from the server's 402 response.
 */
export class X402Node implements INodeType {
    description = {
        displayName: 'X402 Client',
        name: 'x402Client',
        group: ['payment'],
        version: 1,
        description: 'Call x402-protected APIs with automatic payment handling',
        inputs: ['main'],
        outputs: ['main'],
        telegramNotify: true,
        properties: [
            {
                displayName: 'API URL',
                name: 'apiUrl',
                type: 'string' as const,
                default: '',
                placeholder: 'http://localhost:3000/api/x402/premium',
                description: 'URL of the x402-protected API endpoint',
                required: true,
            },
            {
                displayName: 'Account ID',
                name: 'accountId',
                type: 'string' as const,
                default: '',
                placeholder: 'uuid-of-account',
                description: 'Server-managed account to use for payment (from accounts table)',
                required: true,
            },
            {
                displayName: 'Network',
                name: 'network',
                type: 'options' as const,
                default: 'devnet',
                description: 'Solana network to use',
                options: [
                    {
                        name: 'Devnet',
                        value: 'devnet',
                    },
                    {
                        name: 'Mainnet Beta',
                        value: 'mainnet-beta',
                    },
                ],
            },
        ],
    };

    async execute(context: IExecuteContext): Promise<NodeExecutionData[][]> {
        const items = context.getInputData();
        const returnData: NodeExecutionData[] = [];

        // Get X402ClientService from context
        // In a real implementation, this would be injected via NestJS DI
        const x402ClientService = context.getNodeParameter('x402ClientService', 0) as X402ClientService;

        if (!x402ClientService) {
            throw new Error('X402ClientService not available in execution context');
        }

        for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
            try {
                // Get parameters
                const apiUrl = context.getNodeParameter('apiUrl', itemIndex) as string;
                const accountId = context.getNodeParameter('accountId', itemIndex) as string;
                const network = context.getNodeParameter('network', itemIndex, 'devnet') as
                    | 'devnet'
                    | 'mainnet-beta';

                // Validate required parameters
                if (!apiUrl) {
                    throw new Error('API URL is required');
                }

                if (!accountId) {
                    throw new Error('Account ID is required');
                }

                console.log(`\nX402 Node: Calling paid API`);
                console.log(`  API URL: ${apiUrl}`);
                console.log(`  Account: ${accountId}`);
                console.log(`  Network: ${network}\n`);

                // Call x402-protected API using client service
                // This automatically handles the entire payment flow!
                const result = await x402ClientService.fetchWithPaymentDetails(
                    apiUrl,
                    accountId,
                    network,
                );

                console.log(`✓ X402 payment successful\n`);

                returnData.push({
                    json: {
                        success: true,
                        operation: 'x402_fetch',
                        apiUrl,
                        accountId,
                        accountUsed: result.accountUsed,
                        network,
                        data: result.data,
                    },
                });
            } catch (error) {
                // Error handling
                const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                console.error(`✗ X402 payment failed: ${errorMessage}\n`);

                returnData.push({
                    json: {
                        success: false,
                        operation: 'x402_fetch',
                        error: errorMessage,
                        apiUrl: context.getNodeParameter('apiUrl', itemIndex),
                        accountId: context.getNodeParameter('accountId', itemIndex),
                        network: context.getNodeParameter('network', itemIndex, 'devnet'),
                    },
                });
            }
        }

        return [returnData];
    }
}
