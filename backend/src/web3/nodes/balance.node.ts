import { type INodeType, type IExecuteContext, type NodeExecutionData } from '../workflow-types';
import { AgentKitService } from '../services/agent-kit.service';
import { TOKEN_ADDRESS } from '../constants';
import { PublicKey, Connection, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { getAssociatedTokenAddress, getAccount, getMint } from '@solana/spl-token';

export type TokenTicker = keyof typeof TOKEN_ADDRESS;

/**
 * Balance Node
 *
 * 查詢錢包的 SOL 或 SPL Token 餘額
 * 可用於條件判斷（例如：餘額 > X 才執行後續節點）
 */
export class BalanceNode implements INodeType {
  description = {
    displayName: 'Get Balance',
    name: 'getBalance',
    group: ['query'],
    version: 1,
    description: 'Query SOL or SPL token balance for an account',
    inputs: ['main'],
    outputs: ['main'],
    telegramNotify: false,
    isTrigger: false,
    properties: [
      {
        displayName: 'Account ID',
        name: 'accountId',
        type: 'string' as const,
        default: '',
        description: 'Account ID to query balance (uses Crossmint custodial wallet)',
      },
      {
        displayName: 'Token',
        name: 'token',
        type: 'string' as const,
        default: 'SOL',
        description:
          'Token to query (e.g., SOL, USDC). See src/web3/constants.ts for available tokens.',
      },
      {
        displayName: 'Condition',
        name: 'condition',
        type: 'options' as const,
        default: 'none',
        description:
          'Optional condition to check. If condition fails, subsequent nodes will not execute.',
        options: [
          { name: 'None (always pass)', value: 'none' },
          { name: 'Greater than', value: 'gt' },
          { name: 'Less than', value: 'lt' },
          { name: 'Equal to', value: 'eq' },
          { name: 'Greater or equal', value: 'gte' },
          { name: 'Less or equal', value: 'lte' },
        ],
      },
      {
        displayName: 'Threshold Amount',
        name: 'threshold',
        type: 'string' as const,
        default: '0',
        description: 'Threshold amount for condition check (human readable)',
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
        const token = context.getNodeParameter('token', itemIndex) as TokenTicker;
        const condition = context.getNodeParameter('condition', itemIndex, 'none') as string;
        const threshold = parseFloat(
          context.getNodeParameter('threshold', itemIndex, '0') as string,
        );

        if (!accountId) {
          throw new Error('Account ID is required');
        }

        console.log(`\nBalance Node: Querying balance`);
        console.log(`  Account: ${accountId}`);
        console.log(`  Token: ${token}`);

        // 獲取錢包
        const wallet = await agentKitService.getWalletForAccount(accountId);
        const connection = new Connection(agentKitService.getRpcUrl());

        let balance: number;
        let decimals: number;

        if (token === 'SOL') {
          // SOL 餘額
          const lamports = await connection.getBalance(wallet.publicKey);
          balance = lamports / LAMPORTS_PER_SOL;
          decimals = 9;
        } else {
          // SPL Token 餘額
          const tokenMint = TOKEN_ADDRESS[token];
          if (!tokenMint) {
            throw new Error(`Unknown token: ${token}`);
          }

          const mintPubkey = new PublicKey(tokenMint);
          const tokenAccount = await getAssociatedTokenAddress(mintPubkey, wallet.publicKey);

          try {
            const account = await getAccount(connection, tokenAccount);
            const mintInfo = await getMint(connection, mintPubkey);
            decimals = mintInfo.decimals;
            balance = Number(account.amount) / Math.pow(10, decimals);
          } catch (e) {
            // Token account doesn't exist = balance is 0
            balance = 0;
            const mintInfo = await getMint(connection, mintPubkey);
            decimals = mintInfo.decimals;
          }
        }

        console.log(`  Balance: ${balance} ${token}`);

        // 檢查條件
        let conditionMet = true;
        let conditionMessage = '';

        if (condition !== 'none') {
          switch (condition) {
            case 'gt':
              conditionMet = balance > threshold;
              conditionMessage = `${balance} > ${threshold}`;
              break;
            case 'lt':
              conditionMet = balance < threshold;
              conditionMessage = `${balance} < ${threshold}`;
              break;
            case 'eq':
              conditionMet = balance === threshold;
              conditionMessage = `${balance} == ${threshold}`;
              break;
            case 'gte':
              conditionMet = balance >= threshold;
              conditionMessage = `${balance} >= ${threshold}`;
              break;
            case 'lte':
              conditionMet = balance <= threshold;
              conditionMessage = `${balance} <= ${threshold}`;
              break;
          }

          console.log(`  Condition: ${conditionMessage} = ${conditionMet}`);

          if (!conditionMet) {
            throw new Error(`Balance condition not met: ${conditionMessage}`);
          }
        }

        returnData.push({
          json: {
            success: true,
            operation: 'getBalance',
            token,
            balance,
            decimals,
            walletAddress: wallet.publicKey.toBase58(),
            accountId,
            condition:
              condition !== 'none' ? { type: condition, threshold, met: conditionMet } : null,
          },
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        returnData.push({
          json: {
            success: false,
            error: errorMessage,
            operation: 'getBalance',
            token: context.getNodeParameter('token', itemIndex),
          },
        });
      }
    }

    return [returnData];
  }
}
