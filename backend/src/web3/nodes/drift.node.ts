import { type INodeType, type IExecuteContext, type NodeExecutionData } from '../workflow-types';
import { AgentKitService } from '../services/agent-kit.service';
import { Connection, VersionedTransaction } from '@solana/web3.js';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const createLimiter = (max: number) => {
  let active = 0;
  const queue: Array<() => void> = [];
  return async <T>(fn: () => Promise<T>): Promise<T> => {
    if (active >= max) {
      await new Promise<void>((resolve) => queue.push(resolve));
    }
    active += 1;
    try {
      return await fn();
    } finally {
      active -= 1;
      const next = queue.shift();
      if (next) next();
    }
  };
};

const withRetry = async <T>(
  fn: () => Promise<T>,
  attempts: number = 3,
  baseDelay: number = 200,
  maxDelay: number = 2000,
): Promise<T> => {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt === attempts - 1) break;
      const delay = Math.min(maxDelay, baseDelay * 2 ** attempt);
      const jitter = Math.floor(Math.random() * delay * 0.2);
      await sleep(delay + jitter);
    }
  }
  throw lastError;
};

const fetchWithTimeout = async (
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number = 10000,
) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
};

const externalApiLimiter = createLimiter(5);

/**
 * Drift Perpetual Markets
 */
const DRIFT_MARKETS = {
  'SOL-PERP': 0,
  'BTC-PERP': 1,
  'ETH-PERP': 2,
  'APT-PERP': 3,
  'MATIC-PERP': 4,
  'ARB-PERP': 5,
  'DOGE-PERP': 6,
  'BNB-PERP': 7,
  'SUI-PERP': 8,
  'PEPE-PERP': 9,
  '1MPEPE-PERP': 10,
  'OP-PERP': 11,
  'RENDER-PERP': 12,
  'XRP-PERP': 13,
  'HNT-PERP': 14,
  'INJ-PERP': 15,
  'RNDR-PERP': 16,
  'LINK-PERP': 17,
  'RLB-PERP': 18,
  'PYTH-PERP': 19,
  'TIA-PERP': 20,
  'JTO-PERP': 21,
  'SEI-PERP': 22,
  'AVAX-PERP': 23,
  'WIF-PERP': 24,
  'JUP-PERP': 25,
  'DYM-PERP': 26,
  'TAO-PERP': 27,
  'W-PERP': 28,
  'KMNO-PERP': 29,
  'TNSR-PERP': 30,
} as const;

type DriftMarket = keyof typeof DRIFT_MARKETS;

/**
 * Drift Node
 *
 * 開/平倉永續合約、查詢資金費率
 * 使用 Crossmint 託管錢包
 */
export class DriftNode implements INodeType {
  description = {
    displayName: 'Drift Perpetual',
    name: 'driftPerp',
    group: ['defi'],
    version: 1,
    description: 'Trade perpetual contracts on Drift Protocol using Crossmint custodial wallet',
    inputs: ['main'],
    outputs: ['main'],
    telegramNotify: true,
    properties: [
      {
        displayName: 'Account ID',
        name: 'accountId',
        type: 'string' as const,
        default: '',
        description: 'Account ID to use for trading (uses Crossmint custodial wallet)',
      },
      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options' as const,
        default: 'openLong',
        description: 'The operation to perform',
        options: [
          { name: 'Open Long', value: 'openLong' },
          { name: 'Open Short', value: 'openShort' },
          { name: 'Close Position', value: 'close' },
          { name: 'Get Funding Rate', value: 'fundingRate' },
        ],
      },
      {
        displayName: 'Market',
        name: 'market',
        type: 'string' as const,
        default: 'SOL-PERP',
        description: 'Perpetual market (e.g., SOL-PERP, BTC-PERP, ETH-PERP)',
      },
      {
        displayName: 'Amount (USD)',
        name: 'amount',
        type: 'string' as const,
        default: '',
        description: 'Position size in USD (for open operations)',
      },
      {
        displayName: 'Leverage',
        name: 'leverage',
        type: 'string' as const,
        default: '1',
        description: 'Leverage multiplier (1-20x)',
      },
      {
        displayName: 'Order Type',
        name: 'orderType',
        type: 'options' as const,
        default: 'market',
        description: 'Order type',
        options: [
          { name: 'Market', value: 'market' },
          { name: 'Limit', value: 'limit' },
        ],
      },
      {
        displayName: 'Limit Price',
        name: 'limitPrice',
        type: 'string' as const,
        default: '',
        description: 'Limit price (only for limit orders)',
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
        const market = context.getNodeParameter('market', itemIndex) as DriftMarket;

        if (!accountId) {
          throw new Error('Account ID is required');
        }

        const marketIndex = DRIFT_MARKETS[market];
        if (marketIndex === undefined) {
          throw new Error(
            `Unknown market: ${market}. Available: ${Object.keys(DRIFT_MARKETS).join(', ')}`,
          );
        }

        console.log(`\nDrift Node: Executing ${operation} on ${market}`);
        console.log(`  Account: ${accountId}`);

        const wallet = await agentKitService.getWalletForAccount(accountId);
        const connection = new Connection(agentKitService.getRpcUrl());

        if (operation === 'fundingRate') {
          // 獲取資金費率
          const fundingRate = await this.getFundingRate(market);

          returnData.push({
            json: {
              success: true,
              operation: 'fundingRate',
              market,
              fundingRate: fundingRate.rate,
              fundingRateAnnualized: fundingRate.annualized,
              longRate: fundingRate.longRate,
              shortRate: fundingRate.shortRate,
              nextFundingTime: fundingRate.nextFundingTime,
            },
          });
        } else {
          // 開/平倉操作
          const amount = parseFloat(context.getNodeParameter('amount', itemIndex, '0') as string);
          const leverage = parseFloat(
            context.getNodeParameter('leverage', itemIndex, '1') as string,
          );
          const orderType = context.getNodeParameter('orderType', itemIndex, 'market') as string;
          const limitPrice = parseFloat(
            context.getNodeParameter('limitPrice', itemIndex, '0') as string,
          );

          if ((operation === 'openLong' || operation === 'openShort') && amount <= 0) {
            throw new Error('Amount is required for opening positions');
          }

          if (leverage < 1 || leverage > 20) {
            throw new Error('Leverage must be between 1 and 20');
          }

          // 建立 Drift 交易
          const txResult = await this.buildDriftTransaction({
            wallet,
            connection,
            operation,
            marketIndex,
            amount,
            leverage,
            orderType,
            limitPrice: orderType === 'limit' ? limitPrice : undefined,
          });

          console.log(`  ${operation} completed: ${txResult.signature}`);

          returnData.push({
            json: {
              success: true,
              operation,
              market,
              amount,
              leverage,
              orderType,
              limitPrice: orderType === 'limit' ? limitPrice : null,
              signature: txResult.signature,
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
            market: context.getNodeParameter('market', itemIndex),
          },
        });
      }
    }

    return [returnData];
  }

  /**
   * 獲取資金費率
   */
  private async getFundingRate(market: string): Promise<{
    rate: number;
    annualized: number;
    longRate: number;
    shortRate: number;
    nextFundingTime: string;
  }> {
    // 使用 Drift API 獲取資金費率
    const response = await withRetry(() =>
      externalApiLimiter(() =>
        fetchWithTimeout(
          `https://mainnet-beta.api.drift.trade/fundingRates?marketSymbol=${market}`,
          {},
          10000,
        ),
      ),
    );

    if (!response.ok) {
      throw new Error(`Failed to get funding rate: ${response.statusText}`);
    }

    const data = await response.json();

    // 計算年化資金費率
    const hourlyRate = data.fundingRate || 0;
    const annualized = hourlyRate * 24 * 365 * 100; // 轉換為百分比

    return {
      rate: hourlyRate,
      annualized,
      longRate: data.longFundingRate || hourlyRate,
      shortRate: data.shortFundingRate || -hourlyRate,
      nextFundingTime: data.nextFundingTime || new Date(Date.now() + 3600000).toISOString(),
    };
  }

  /**
   * 建立 Drift 交易
   */
  private async buildDriftTransaction(params: {
    wallet: any;
    connection: Connection;
    operation: string;
    marketIndex: number;
    amount: number;
    leverage: number;
    orderType: string;
    limitPrice?: number;
  }): Promise<{ signature: string }> {
    const { wallet, operation, marketIndex, amount, leverage, orderType, limitPrice } = params;

    // 使用 Drift Gateway API 建立交易
    const direction =
      operation === 'openLong' ? 'long' : operation === 'openShort' ? 'short' : 'close';

    const requestBody: any = {
      marketIndex,
      marketType: 'perp',
      amount: amount * leverage, // 實際倉位大小
      direction,
      orderType,
      userPubkey: wallet.publicKey.toBase58(),
    };

    if (orderType === 'limit' && limitPrice) {
      requestBody.price = limitPrice;
    }

    const response = await fetch('https://mainnet-beta.api.drift.trade/orders', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(`Drift API error: ${errorData.error || response.statusText}`);
    }

    const result = await response.json();

    // 如果返回交易需要簽名
    if (result.transaction) {
      const transactionBuffer = Buffer.from(result.transaction, 'base64');
      const transaction = VersionedTransaction.deserialize(transactionBuffer);
      const signResult = await wallet.signAndSendTransaction(transaction);
      return { signature: signResult.signature };
    }

    return { signature: result.signature || result.txId };
  }
}
