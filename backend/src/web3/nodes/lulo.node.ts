import { type INodeType, type IExecuteContext, type NodeExecutionData } from '../workflow-types';
import { AgentKitService } from '../services/agent-kit.service';
import { TOKEN_ADDRESS } from '../constants';
import { VersionedTransaction } from '@solana/web3.js';

type TokenTicker = keyof typeof TOKEN_ADDRESS;

/**
 * Lulo API Response
 */
interface LuloTransactionResponse {
  transaction: string;
  priorityFee?: number;
}

interface LuloAccountResponse {
  deposits: Array<{
    mint: string;
    amount: number;
    apy: number;
    protocol: string;
  }>;
  totalValueUsd: number;
}

/**
 * Lulo Node
 *
 * 存款賺取利息、提款
 * 使用 Crossmint 託管錢包
 * Lulo 是一個聚合借貸協議，自動尋找最佳收益率
 */
export class LuloNode implements INodeType {
  description = {
    displayName: 'Lulo Lending',
    name: 'luloLend',
    group: ['defi'],
    version: 1,
    description: 'Lend assets on Lulo for yield using Crossmint custodial wallet',
    inputs: ['main'],
    outputs: ['main'],
    telegramNotify: true,
    properties: [
      {
        displayName: 'Account ID',
        name: 'accountId',
        type: 'string' as const,
        default: '',
        description: 'Account ID to use (uses Crossmint custodial wallet)',
      },
      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options' as const,
        default: 'deposit',
        description: 'The operation to perform',
        options: [
          { name: 'Deposit (Lend)', value: 'deposit' },
          { name: 'Withdraw', value: 'withdraw' },
          { name: 'Get Account Info', value: 'info' },
        ],
      },
      {
        displayName: 'Token',
        name: 'token',
        type: 'string' as const,
        default: 'USDC',
        description: 'Token to lend/withdraw (e.g., USDC, SOL)',
      },
      {
        displayName: 'Amount',
        name: 'amount',
        type: 'string' as const,
        default: 'auto',
        description:
          'Amount to deposit/withdraw. Use "auto" for previous node output, "all" for entire balance, or a number',
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
        const operation = context.getNodeParameter('operation', itemIndex) as string;
        const token = context.getNodeParameter('token', itemIndex) as TokenTicker;
        const amountParam = context.getNodeParameter('amount', itemIndex, 'auto') as string;

        if (!accountId) {
          throw new Error('Account ID is required');
        }

        const tokenMint = TOKEN_ADDRESS[token];
        if (!tokenMint && operation !== 'info') {
          throw new Error(`Unknown token: ${token}`);
        }

        console.log(`\nLulo Node: Executing ${operation}`);
        console.log(`  Account: ${accountId}`);
        console.log(`  Token: ${token}`);

        const wallet = await agentKitService.getWalletForAccount(accountId);
        const walletAddress = wallet.publicKey.toBase58();
        if (operation === 'info') {
          // 獲取帳戶資訊
          const accountInfo = await this.getAccountInfo(walletAddress);

          returnData.push({
            json: {
              success: true,
              operation: 'info',
              walletAddress,
              deposits: accountInfo.deposits,
              totalValueUsd: accountInfo.totalValueUsd,
              accountId,
            },
          });
        } else {
          // 解析金額
          let amount = this.parseAmount(amountParam, items);

          if (operation === 'withdraw' && amountParam.toLowerCase() === 'all') {
            // 獲取當前存款餘額
            const accountInfo = await this.getAccountInfo(walletAddress);
            const deposit = accountInfo.deposits.find((d) => d.mint === tokenMint);
            amount = deposit?.amount || 0;
          }

          if (amount <= 0) {
            throw new Error('Valid amount is required');
          }

          console.log(`  Amount: ${amount} ${token}`);

          // 獲取交易
          const txResponse = await this.getLuloTransaction({
            walletAddress,
            operation,
            mintAddress: tokenMint,
            amount,
          });

          // 簽名並發送交易
          const transactionBuffer = Buffer.from(txResponse.transaction, 'base64');
          const transaction = VersionedTransaction.deserialize(transactionBuffer);
          const signResult = await wallet.signAndSendTransaction(transaction);

          console.log(`  ${operation} completed: ${signResult.signature}`);

          returnData.push({
            json: {
              success: true,
              operation,
              token,
              amount,
              signature: signResult.signature,
              walletAddress,
              accountId,
            },
          });
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        returnData.push({
          json: {
            success: false,
            error: errorMessage,
            operation: context.getNodeParameter('operation', itemIndex),
            token: context.getNodeParameter('token', itemIndex),
          },
        });
      }
    }

    return [returnData];
  }

  /**
   * 解析金額
   */
  private parseAmount(amountStr: string, items: NodeExecutionData[]): number {
    const normalized = amountStr.toLowerCase().trim();

    if (normalized === 'auto') {
      // 從前一個節點讀取
      if (items.length > 0 && items[0].json) {
        const prev = items[0].json;
        if (prev.outputAmount !== undefined) return parseFloat(prev.outputAmount);
        if (prev.amount !== undefined) return parseFloat(prev.amount);
      }
      return 0;
    }

    if (normalized === 'all' || normalized === 'half') {
      // 這些會在 execute 中特殊處理
      return 0;
    }

    return parseFloat(amountStr);
  }

  /**
   * 獲取 Lulo 帳戶資訊
   */
  private async getAccountInfo(
    walletAddress: string,
    apiKey?: string,
  ): Promise<LuloAccountResponse> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'x-wallet-pubkey': walletAddress,
    };

    if (apiKey) {
      headers['x-api-key'] = apiKey;
    }

    const response = await fetch(`https://api.flexlend.fi/account?wallet=${walletAddress}`, {
      headers,
    });

    if (!response.ok) {
      // 如果帳戶不存在，返回空資料
      if (response.status === 404) {
        return { deposits: [], totalValueUsd: 0 };
      }
      throw new Error(`Failed to get Lulo account info: ${response.statusText}`);
    }

    return response.json();
  }

  /**
   * 獲取 Lulo 交易
   */
  private async getLuloTransaction(params: {
    walletAddress: string;
    operation: string;
    mintAddress: string;
    amount: number;
    apiKey?: string;
  }): Promise<LuloTransactionResponse> {
    const { walletAddress, operation, mintAddress, amount, apiKey } = params;

    const endpoint = operation === 'deposit' ? 'deposit' : 'withdraw';

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'x-wallet-pubkey': walletAddress,
    };

    if (apiKey) {
      headers['x-api-key'] = apiKey;
    }

    const response = await fetch(`https://api.flexlend.fi/${endpoint}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        owner: walletAddress,
        mintAddress,
        depositAmount: operation === 'deposit' ? amount.toString() : undefined,
        withdrawAmount: operation === 'withdraw' ? amount.toString() : undefined,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(
        `Lulo API error: ${errorData.error || errorData.message || response.statusText}`,
      );
    }

    return response.json();
  }
}
