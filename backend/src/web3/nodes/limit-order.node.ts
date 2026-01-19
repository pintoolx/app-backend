import { type INodeType, type IExecuteContext, type NodeExecutionData } from '../workflow-types';
import { AgentKitService } from '../services/agent-kit.service';
import { TOKEN_ADDRESS } from '../constants';
import { Connection } from '@solana/web3.js';

export type TokenTicker = keyof typeof TOKEN_ADDRESS;

/**
 * Jupiter Trigger API Response
 */
interface JupiterTriggerResponse {
  order: string;
  transaction: string;
  requestId: string;
}

/**
 * Limit Order Node
 *
 * 使用 Jupiter Trigger API 創建限價單
 * 使用 Crossmint 託管錢包
 */
export class LimitOrderNode implements INodeType {
  description = {
    displayName: 'Jupiter Limit Order',
    name: 'jupiterLimitOrder',
    group: ['swap'],
    version: 1,
    description: 'Create a limit order on Jupiter using Crossmint custodial wallet',
    inputs: ['main'],
    outputs: ['main'],
    telegramNotify: true,
    properties: [
      {
        displayName: 'Account ID',
        name: 'accountId',
        type: 'string' as const,
        default: '',
        description: 'Account ID to use for the limit order (uses Crossmint custodial wallet)',
      },
      {
        displayName: 'Input Token',
        name: 'inputToken',
        type: 'string' as const,
        default: 'USDC',
        description: 'Token to sell (e.g., USDC, SOL)',
      },
      {
        displayName: 'Output Token',
        name: 'outputToken',
        type: 'string' as const,
        default: 'SOL',
        description: 'Token to buy (e.g., SOL, USDC)',
      },
      {
        displayName: 'Input Amount',
        name: 'inputAmount',
        type: 'string' as const,
        default: '',
        description: 'Amount of input token to sell (human readable, minimum ~5 USD)',
      },
      {
        displayName: 'Target Price',
        name: 'targetPrice',
        type: 'string' as const,
        default: '',
        description: 'Target price (output tokens per input token)',
      },
      {
        displayName: 'Expiry (hours)',
        name: 'expiryHours',
        type: 'string' as const,
        default: '24',
        description: 'Order expiry time in hours (default: 24)',
      },
    ],
  };

  async execute(context: IExecuteContext): Promise<NodeExecutionData[][]> {
    const items = context.getInputData();
    const returnData: NodeExecutionData[] = [];

    const agentKitService = context.getNodeParameter('agentKitService', 0) as AgentKitService;

    if (!agentKitService) {
      throw new Error('AgentKitService not available in execution context');
    }

    for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
      try {
        const accountId = context.getNodeParameter('accountId', itemIndex) as string;
        const inputToken = context.getNodeParameter('inputToken', itemIndex) as TokenTicker;
        const outputToken = context.getNodeParameter('outputToken', itemIndex) as TokenTicker;
        const inputAmount = parseFloat(
          context.getNodeParameter('inputAmount', itemIndex) as string,
        );
        const targetPrice = parseFloat(
          context.getNodeParameter('targetPrice', itemIndex) as string,
        );
        const expiryHours = parseInt(
          context.getNodeParameter('expiryHours', itemIndex, '24') as string,
        );

        if (!accountId) {
          throw new Error('Account ID is required');
        }
        if (isNaN(inputAmount) || inputAmount <= 0) {
          throw new Error('Valid input amount is required');
        }
        if (isNaN(targetPrice) || targetPrice <= 0) {
          throw new Error('Valid target price is required');
        }

        // 獲取 token addresses
        const inputMint = TOKEN_ADDRESS[inputToken];
        const outputMint = TOKEN_ADDRESS[outputToken];

        if (!inputMint) {
          throw new Error(`Unknown input token: ${inputToken}`);
        }
        if (!outputMint) {
          throw new Error(`Unknown output token: ${outputToken}`);
        }

        console.log(`\nLimit Order Node: Creating limit order via Jupiter Trigger API`);
        console.log(`  Account: ${accountId}`);
        console.log(`  Sell: ${inputAmount} ${inputToken}`);
        console.log(`  Buy: ${outputToken} @ ${targetPrice}`);
        console.log(`  Expiry: ${expiryHours} hours`);

        // 獲取錢包
        const wallet = await agentKitService.getWalletForAccount(accountId);
        const walletAddress = wallet.publicKey.toBase58();

        // 獲取 token decimals
        const connection = new Connection(agentKitService.getRpcUrl());
        const { getMint } = await import('@solana/spl-token');
        const { PublicKey } = await import('@solana/web3.js');

        let inputDecimals = 9; // SOL default
        if (inputToken !== 'SOL') {
          const mintInfo = await getMint(connection, new PublicKey(inputMint));
          inputDecimals = mintInfo.decimals;
        }

        let outputDecimals = 9; // SOL default
        if (outputToken !== 'SOL') {
          const mintInfo = await getMint(connection, new PublicKey(outputMint));
          outputDecimals = mintInfo.decimals;
        }

        // 計算最小單位的數量
        const makingAmount = Math.round(inputAmount * Math.pow(10, inputDecimals)).toString();
        const takingAmount = Math.round(
          inputAmount * targetPrice * Math.pow(10, outputDecimals),
        ).toString();

        // 計算過期時間 (Unix timestamp in seconds)
        const expiredAt = Math.floor(Date.now() / 1000) + expiryHours * 60 * 60;

        // 調用 Jupiter Trigger API
        const response = await fetch('https://api.jup.ag/trigger/v1/createOrder', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            inputMint,
            outputMint,
            maker: walletAddress,
            payer: walletAddress,
            params: {
              makingAmount,
              takingAmount,
              expiredAt: expiredAt.toString(),
            },
            computeUnitPrice: 'auto',
          }),
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(
            `Jupiter API error: ${errorData.error || errorData.cause || response.statusText}`,
          );
        }

        const result: JupiterTriggerResponse = await response.json();

        console.log(`  Order created: ${result.order}`);
        console.log(`  Request ID: ${result.requestId}`);

        // 簽名並發送交易
        const { VersionedTransaction } = await import('@solana/web3.js');
        const transactionBuffer = Buffer.from(result.transaction, 'base64');
        const transaction = VersionedTransaction.deserialize(transactionBuffer);

        const signResult = await wallet.signAndSendTransaction(transaction);

        console.log(`  Transaction sent: ${signResult.signature}`);

        returnData.push({
          json: {
            success: true,
            operation: 'limitOrder',
            orderId: result.order,
            requestId: result.requestId,
            signature: signResult.signature,
            inputToken,
            outputToken,
            inputAmount,
            outputAmount: inputAmount * targetPrice,
            targetPrice,
            expiryHours,
            expiredAt: new Date(expiredAt * 1000).toISOString(),
            accountId,
            walletAddress,
          },
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        returnData.push({
          json: {
            success: false,
            error: errorMessage,
            operation: 'limitOrder',
            inputToken: context.getNodeParameter('inputToken', itemIndex),
            outputToken: context.getNodeParameter('outputToken', itemIndex),
          },
        });
      }
    }

    return [returnData];
  }
}
