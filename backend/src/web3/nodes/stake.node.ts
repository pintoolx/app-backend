import { type INodeType, type IExecuteContext, type NodeExecutionData } from '../workflow-types';
import { AgentKitService } from '../services/agent-kit.service';
import { Connection, VersionedTransaction, LAMPORTS_PER_SOL } from '@solana/web3.js';

/**
 * Stake Node
 *
 * 將 SOL 質押獲取 jupSOL (Jupiter 流動性質押)
 * 使用 Crossmint 託管錢包
 *
 * 使用 Jupiter Staking:
 * - 自動複利
 * - 無鎖定期
 * - 可隨時贖回
 */
export class StakeNode implements INodeType {
  description = {
    displayName: 'Stake SOL',
    name: 'stakeSOL',
    group: ['defi'],
    version: 1,
    description:
      'Stake SOL for jupSOL using Jupiter staking (liquid staking with Crossmint wallet)',
    inputs: ['main'],
    outputs: ['main'],
    telegramNotify: true,
    isTrigger: false,
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
        default: 'stake',
        description: 'The operation to perform',
        options: [
          { name: 'Stake SOL → jupSOL', value: 'stake' },
          { name: 'Unstake jupSOL → SOL', value: 'unstake' },
          { name: 'Get Staking Info', value: 'info' },
        ],
      },
      {
        displayName: 'Amount',
        name: 'amount',
        type: 'string' as const,
        default: 'auto',
        description:
          'Amount to stake/unstake. Use "auto" for previous node output, "all" for entire balance, or a number (minimum 0.1 SOL)',
      },
    ],
  };

  // Jupiter Staking 常量
  private readonly JUPSOL_MINT = 'jupSoLaHXQiZZTSfEWMTRRgpnyFm8f6sZdosWBjx93v';
  private readonly SOL_MINT = 'So11111111111111111111111111111111111111112';
  private readonly MIN_STAKE_AMOUNT = 0.1; // 最小質押量

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
        const amountParam = context.getNodeParameter('amount', itemIndex, 'auto') as string;

        if (!accountId) {
          throw new Error('Account ID is required');
        }

        console.log(`\nStake Node: Executing ${operation}`);
        console.log(`  Account: ${accountId}`);

        const wallet = await agentKitService.getWalletForAccount(accountId);
        const walletAddress = wallet.publicKey.toBase58();
        const connection = new Connection(agentKitService.getRpcUrl());

        if (operation === 'info') {
          // 獲取質押資訊
          const info = await this.getStakingInfo(walletAddress, connection);

          returnData.push({
            json: {
              success: true,
              operation: 'info',
              walletAddress,
              solBalance: info.solBalance,
              jupsolBalance: info.jupsolBalance,
              jupsolValueInSol: info.jupsolValueInSol,
              exchangeRate: info.exchangeRate,
              apy: info.apy,
              accountId,
            },
          });
        } else {
          // 解析金額
          let amount = this.parseAmount(amountParam, items);

          if (amountParam.toLowerCase() === 'all') {
            if (operation === 'stake') {
              // 獲取 SOL 餘額 (保留一些用於交易費)
              const balance = await connection.getBalance(wallet.publicKey);
              amount = Math.max(0, balance / LAMPORTS_PER_SOL - 0.01); // 保留 0.01 SOL
            } else {
              // 獲取 jupSOL 餘額
              const jupsolBalance = await this.getJupsolBalance(walletAddress, connection);
              amount = jupsolBalance;
            }
          }

          if (operation === 'stake' && amount < this.MIN_STAKE_AMOUNT) {
            throw new Error(`Minimum stake amount is ${this.MIN_STAKE_AMOUNT} SOL`);
          }

          if (amount <= 0) {
            throw new Error('Valid amount is required');
          }

          console.log(`  Amount: ${amount} ${operation === 'stake' ? 'SOL' : 'jupSOL'}`);

          // 使用 Jupiter API 執行質押/解質押
          const inputMint = operation === 'stake' ? this.SOL_MINT : this.JUPSOL_MINT;
          const outputMint = operation === 'stake' ? this.JUPSOL_MINT : this.SOL_MINT;
          const amountLamports = Math.round(amount * LAMPORTS_PER_SOL);

          // 獲取報價
          const { createJupiterApiClient } = await import('@jup-ag/api');
          const jupiterApi = createJupiterApiClient();

          const quote = await jupiterApi.quoteGet({
            inputMint,
            outputMint,
            amount: amountLamports,
            slippageBps: 10, // 0.1% slippage for staking
          });

          console.log(`  Quote: ${quote.outAmount} output tokens`);

          // 獲取交易
          const swapResult = await jupiterApi.swapPost({
            swapRequest: {
              quoteResponse: quote,
              userPublicKey: walletAddress,
              wrapAndUnwrapSol: true,
            },
          });

          // 簽名並發送交易
          const swapTransactionBuf = Buffer.from(swapResult.swapTransaction, 'base64');
          const transaction = VersionedTransaction.deserialize(swapTransactionBuf);
          const signResult = await wallet.signAndSendTransaction(transaction);

          console.log(`  ${operation} completed: ${signResult.signature}`);

          const outputAmount = parseInt(quote.outAmount) / LAMPORTS_PER_SOL;

          returnData.push({
            json: {
              success: true,
              operation,
              inputAmount: amount,
              inputToken: operation === 'stake' ? 'SOL' : 'jupSOL',
              outputAmount,
              outputToken: operation === 'stake' ? 'jupSOL' : 'SOL',
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
            amount: context.getNodeParameter('amount', itemIndex),
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
      if (items.length > 0 && items[0].json) {
        const prev = items[0].json;
        if (prev.outputAmount !== undefined) return parseFloat(prev.outputAmount);
        if (prev.amount !== undefined) return parseFloat(prev.amount);
      }
      return 0;
    }

    if (normalized === 'all' || normalized === 'half') {
      return 0; // 會在 execute 中處理
    }

    return parseFloat(amountStr);
  }

  /**
   * 獲取 jupSOL 餘額
   */
  private async getJupsolBalance(walletAddress: string, connection: Connection): Promise<number> {
    const { PublicKey } = await import('@solana/web3.js');
    const { getAssociatedTokenAddress, getAccount } = await import('@solana/spl-token');

    try {
      const jupsolMint = new PublicKey(this.JUPSOL_MINT);
      const walletPubkey = new PublicKey(walletAddress);
      const tokenAccount = await getAssociatedTokenAddress(jupsolMint, walletPubkey);
      const account = await getAccount(connection, tokenAccount);
      return Number(account.amount) / LAMPORTS_PER_SOL;
    } catch {
      return 0;
    }
  }

  /**
   * 獲取質押資訊
   */
  private async getStakingInfo(
    walletAddress: string,
    connection: Connection,
  ): Promise<{
    solBalance: number;
    jupsolBalance: number;
    jupsolValueInSol: number;
    exchangeRate: number;
    apy: number;
  }> {
    const { PublicKey } = await import('@solana/web3.js');

    // 獲取 SOL 餘額
    const walletPubkey = new PublicKey(walletAddress);
    const solBalance = (await connection.getBalance(walletPubkey)) / LAMPORTS_PER_SOL;

    // 獲取 jupSOL 餘額
    const jupsolBalance = await this.getJupsolBalance(walletAddress, connection);

    // 獲取匯率 (使用 Jupiter API)
    let exchangeRate = 1;
    let jupsolValueInSol = jupsolBalance;

    try {
      const { createJupiterApiClient } = await import('@jup-ag/api');
      const jupiterApi = createJupiterApiClient();

      if (jupsolBalance > 0) {
        const quote = await jupiterApi.quoteGet({
          inputMint: this.JUPSOL_MINT,
          outputMint: this.SOL_MINT,
          amount: Math.round(jupsolBalance * LAMPORTS_PER_SOL),
          slippageBps: 10,
        });

        jupsolValueInSol = parseInt(quote.outAmount) / LAMPORTS_PER_SOL;
        exchangeRate = jupsolValueInSol / jupsolBalance;
      }
    } catch (e) {
      // 使用預設匯率
    }

    // APY 估算 (Jupiter Staking 約 7-8%)
    const apy = 7.5;

    return {
      solBalance,
      jupsolBalance,
      jupsolValueInSol,
      exchangeRate,
      apy,
    };
  }
}
