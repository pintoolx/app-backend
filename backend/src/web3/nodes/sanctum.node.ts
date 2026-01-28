import { type INodeType, type IExecuteContext, type NodeExecutionData } from '../workflow-types';
import { AgentKitService } from '../services/agent-kit.service';
import { VersionedTransaction } from '@solana/web3.js';

/**
 * 流動性質押代幣 (LST) 地址
 */
const LST_MINTS = {
  SOL: 'So11111111111111111111111111111111111111112',
  mSOL: 'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So',
  bSOL: 'bSo13r4TkiE4KumL71LsHTPpL2euBYLFx6h9HP3piy1',
  jitoSOL: 'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn',
  jupSOL: 'jupSoLaHXQiZZTSfEWMTRRgpnyFm8f6sZdosWBjx93v',
  INF: '5oVNBeEEQvYi1cX3ir8Dx5n1P7pdxydbGF2X4TxVusJm',
  hSOL: 'he1iusmfkpAdwvxLNGV8Y1iSbj4rUy6yMhEA3fotn9A',
  laineSOL: 'LAinEtNLgpmCP9Rvsf5Hn8W6EhNiKLZQti1xfWMLy6X',
  compassSOL: 'Comp4ssDzXcLeu2MnLuGNNFC4cmLPMng8qWHPvzAMU1h',
  dSOL: 'Dso1bDeDjCQxTrWHqUUi63oBvV7Mdm6WaobLbQ7gnPQ',
  stSOL: '7dHbWXmci3dT8UFYWYZweBLXgycu7Y3iL6trKn1Y7ARj',
  scnSOL: '5oVNBeEEQvYi1cX3ir8Dx5n1P7pdxydbGF2X4TxVusJm',
  cgntSOL: 'CgnTSoL3DgY9SFHxcLj6CgCgKKoTBr6tp4CPAEWy25DE',
  pwrSOL: 'pWrSoLAhue6jUxUkbWgmEy5rD9VJRsxBUYFL1C2wHD6',
  bonkSOL: 'BonK1YhkXEGLZzwtcvRTip3gAL9nCeQD7ppZBLBzHuh',
} as const;

type LstTicker = keyof typeof LST_MINTS;

/**
 * Sanctum API Responses
 */
interface SanctumQuoteResponse {
  inAmount: string;
  outAmount: string;
  feeAmount: string;
  feePct: string;
  priceImpactPct: string;
}

interface SanctumSwapResponse {
  tx: string;
}

interface SanctumApyResponse {
  [key: string]: number;
}

/**
 * Sanctum Node
 *
 * LST (流動性質押代幣) 交換、獲取 APY
 * 使用 Crossmint 託管錢包
 */
export class SanctumNode implements INodeType {
  description = {
    displayName: 'Sanctum LST',
    name: 'sanctumLst',
    group: ['defi'],
    version: 1,
    description: 'Swap Liquid Staking Tokens (LST) on Sanctum using Crossmint custodial wallet',
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
        default: 'swap',
        description: 'The operation to perform',
        options: [
          { name: 'Swap LST', value: 'swap' },
          { name: 'Get APY', value: 'apy' },
          { name: 'Get Quote', value: 'quote' },
        ],
      },
      {
        displayName: 'Input LST',
        name: 'inputLst',
        type: 'string' as const,
        default: 'SOL',
        description: 'Input LST (SOL, mSOL, bSOL, jitoSOL, jupSOL, etc.)',
      },
      {
        displayName: 'Output LST',
        name: 'outputLst',
        type: 'string' as const,
        default: 'jitoSOL',
        description: 'Output LST (SOL, mSOL, bSOL, jitoSOL, jupSOL, etc.)',
      },
      {
        displayName: 'Amount',
        name: 'amount',
        type: 'string' as const,
        default: 'auto',
        description:
          'Amount to swap. Use "auto" for previous node output, "all" for entire balance, or a number',
      },
      {
        displayName: 'Priority Fee (lamports)',
        name: 'priorityFee',
        type: 'string' as const,
        default: '5000',
        description: 'Priority fee in lamports (default: 5000)',
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
        const inputLst = context.getNodeParameter('inputLst', itemIndex) as LstTicker;
        const outputLst = context.getNodeParameter('outputLst', itemIndex) as LstTicker;
        const amountParam = context.getNodeParameter('amount', itemIndex, 'auto') as string;
        const priorityFee = parseInt(
          context.getNodeParameter('priorityFee', itemIndex, '5000') as string,
        );

        if (!accountId && operation !== 'apy') {
          throw new Error('Account ID is required');
        }

        const inputMint = LST_MINTS[inputLst];
        const outputMint = LST_MINTS[outputLst];

        if (!inputMint && operation !== 'apy') {
          throw new Error(
            `Unknown input LST: ${inputLst}. Available: ${Object.keys(LST_MINTS).join(', ')}`,
          );
        }
        if (!outputMint && operation !== 'apy') {
          throw new Error(
            `Unknown output LST: ${outputLst}. Available: ${Object.keys(LST_MINTS).join(', ')}`,
          );
        }

        console.log(`\nSanctum Node: Executing ${operation}`);
        console.log(`  Account: ${accountId}`);

        if (operation === 'apy') {
          // 獲取 APY
          const apys = await this.getApys([inputLst, outputLst]);

          returnData.push({
            json: {
              success: true,
              operation: 'apy',
              apys,
            },
          });
        } else {
          const wallet = await agentKitService.getWalletForAccount(accountId);
          const walletAddress = wallet.publicKey.toBase58();

          // 解析金額 (使用 lamports)
          const amount = this.parseAmount(amountParam, items);

          // 轉換為 lamports (假設 9 decimals for SOL-based LSTs)
          const amountLamports = Math.round(amount * 1e9).toString();

          console.log(`  ${amount} ${inputLst} → ${outputLst}`);

          if (operation === 'quote') {
            // 獲取報價
            const quote = await this.getQuote(inputMint, outputMint, amountLamports);

            returnData.push({
              json: {
                success: true,
                operation: 'quote',
                inputLst,
                outputLst,
                inputAmount: amount,
                outputAmount: parseInt(quote.outAmount) / 1e9,
                feeAmount: parseInt(quote.feeAmount) / 1e9,
                feePct: parseFloat(quote.feePct),
                priceImpactPct: parseFloat(quote.priceImpactPct),
              },
            });
          } else if (operation === 'swap') {
            if (amount <= 0) {
              throw new Error('Valid amount is required for swap');
            }

            // 獲取報價
            const quote = await this.getQuote(inputMint, outputMint, amountLamports);

            // 執行交換
            const swapResponse = await this.executeSwap({
              inputMint,
              outputMint,
              amount: amountLamports,
              quotedAmount: quote.outAmount,
              userPubkey: walletAddress,
              priorityFee,
            });

            // 簽名並發送交易
            const transactionBuffer = Buffer.from(swapResponse.tx, 'base64');
            const transaction = VersionedTransaction.deserialize(transactionBuffer);
            const signResult = await wallet.signAndSendTransaction(transaction);

            console.log(`  Swap completed: ${signResult.signature}`);

            returnData.push({
              json: {
                success: true,
                operation: 'swap',
                inputLst,
                outputLst,
                inputAmount: amount,
                outputAmount: parseInt(quote.outAmount) / 1e9,
                signature: signResult.signature,
                walletAddress,
                accountId,
              },
            });
          }
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        returnData.push({
          json: {
            success: false,
            error: errorMessage,
            operation: context.getNodeParameter('operation', itemIndex),
            inputLst: context.getNodeParameter('inputLst', itemIndex),
            outputLst: context.getNodeParameter('outputLst', itemIndex),
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

    return parseFloat(amountStr);
  }

  /**
   * 獲取 APY
   */
  private async getApys(lstList: string[]): Promise<Record<string, number>> {
    const response = await fetch(
      `https://sanctum-extra-api.ngrok.dev/v1/apy/latest?lst=${lstList.join(',')}`,
      {
        headers: {
          'Content-Type': 'application/json',
        },
      },
    );

    if (!response.ok) {
      throw new Error(`Failed to get APYs: ${response.statusText}`);
    }

    const data: SanctumApyResponse = await response.json();
    return data;
  }

  /**
   * 獲取報價
   */
  private async getQuote(
    inputMint: string,
    outputMint: string,
    amount: string,
  ): Promise<SanctumQuoteResponse> {
    const response = await fetch(
      `https://api.sanctum.so/v1/swap/quote?input=${inputMint}&outputLstMint=${outputMint}&amount=${amount}&mode=ExactIn`,
      {
        headers: {
          'Content-Type': 'application/json',
        },
      },
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(`Sanctum quote error: ${errorData.error || response.statusText}`);
    }

    return response.json();
  }

  /**
   * 執行交換
   */
  private async executeSwap(params: {
    inputMint: string;
    outputMint: string;
    amount: string;
    quotedAmount: string;
    userPubkey: string;
    priorityFee: number;
  }): Promise<SanctumSwapResponse> {
    const { inputMint, outputMint, amount, quotedAmount, userPubkey, priorityFee } = params;

    const response = await fetch('https://api.sanctum.so/v1/swap', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        input: inputMint,
        outputLstMint: outputMint,
        amount,
        quotedAmount,
        signer: userPubkey,
        mode: 'ExactIn',
        priorityFee: {
          Auto: {
            max_unit_price_micro_lamports: priorityFee,
          },
        },
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(`Sanctum swap error: ${errorData.error || response.statusText}`);
    }

    return response.json();
  }
}
