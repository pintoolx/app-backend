import { type INodeType, type IExecuteContext, type NodeExecutionData } from '../workflow-types';
import { ConfigService } from '@nestjs/config';

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
 * Helius Webhook Types
 */
type WebhookType = 'enhanced' | 'raw' | 'discord' | 'rawDevnet' | 'enhancedDevnet';

type TransactionType =
  | 'UNKNOWN'
  | 'NFT_BID'
  | 'NFT_BID_CANCELLED'
  | 'NFT_LISTING'
  | 'NFT_CANCEL_LISTING'
  | 'NFT_SALE'
  | 'NFT_MINT'
  | 'NFT_AUCTION_CREATED'
  | 'NFT_AUCTION_UPDATED'
  | 'NFT_AUCTION_CANCELLED'
  | 'NFT_PARTICIPATION_REWARD'
  | 'NFT_MINT_REJECTED'
  | 'SWAP'
  | 'TRANSFER'
  | 'TOKEN_MINT'
  | 'BURN'
  | 'BURN_NFT'
  | 'STAKE_TOKEN'
  | 'UNSTAKE_TOKEN'
  | 'LOAN'
  | 'REPAY_LOAN'
  | 'ADD_TO_POOL'
  | 'REMOVE_FROM_POOL'
  | 'CLOSE_POSITION'
  | 'UNLABELED'
  | 'CLOSE_ACCOUNT'
  | 'WITHDRAW'
  | 'DEPOSIT'
  | 'INIT_BANK'
  | 'ANY';

interface HeliusWebhookResponse {
  webhookURL: string;
  webhookID: string;
  wallet: string;
  accountAddresses: string[];
  transactionTypes: TransactionType[];
  webhookType: WebhookType;
}

/**
 * Helius Webhook Node
 *
 * 創建、管理 Helius Webhooks
 * 用於監聽鏈上事件並觸發 workflow
 *
 * 注意：這是一個配置節點，用於設定 webhook
 * 實際的 webhook 接收需要在後端設定 webhook endpoint
 */
export class HeliusWebhookNode implements INodeType {
  description = {
    displayName: 'Helius Webhook',
    name: 'heliusWebhook',
    group: ['trigger'],
    version: 1,
    description: 'Create and manage Helius webhooks for on-chain event monitoring',
    inputs: ['main'],
    outputs: ['main'],
    telegramNotify: false,
    properties: [
      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options' as const,
        default: 'create',
        description: 'The operation to perform',
        options: [
          { name: 'Create Webhook', value: 'create' },
          { name: 'Get Webhook', value: 'get' },
          { name: 'Delete Webhook', value: 'delete' },
          { name: 'List All Webhooks', value: 'list' },
        ],
      },
      {
        displayName: 'Webhook ID',
        name: 'webhookId',
        type: 'string' as const,
        default: '',
        description: 'Webhook ID (for get/delete operations)',
      },
      {
        displayName: 'Webhook URL',
        name: 'webhookUrl',
        type: 'string' as const,
        default: '',
        description: 'URL to receive webhook notifications (for create operation)',
      },
      {
        displayName: 'Account Addresses',
        name: 'accountAddresses',
        type: 'string' as const,
        default: '',
        description: 'Comma-separated list of account addresses to monitor (for create operation)',
      },
      {
        displayName: 'Transaction Types',
        name: 'transactionTypes',
        type: 'string' as const,
        default: 'ANY',
        description:
          'Comma-separated transaction types to monitor (SWAP, TRANSFER, NFT_SALE, ANY, etc.)',
      },
      {
        displayName: 'Webhook Type',
        name: 'webhookType',
        type: 'options' as const,
        default: 'enhanced',
        description: 'Type of webhook',
        options: [
          { name: 'Enhanced (Parsed)', value: 'enhanced' },
          { name: 'Raw', value: 'raw' },
          { name: 'Discord', value: 'discord' },
          { name: 'Enhanced Devnet', value: 'enhancedDevnet' },
          { name: 'Raw Devnet', value: 'rawDevnet' },
        ],
      },
    ],
  };

  async execute(context: IExecuteContext): Promise<NodeExecutionData[][]> {
    const items = context.getInputData();
    const returnData: NodeExecutionData[] = [];

    // 從 context 獲取 Helius API Key
    const configService = context.getNodeParameter('configService', 0) as ConfigService;
    const heliusApiKey = configService?.get<string>('helius.apiKey') || process.env.HELIUS_API_KEY;

    if (!heliusApiKey) {
      throw new Error('HELIUS_API_KEY is required. Set it in environment variables.');
    }

    for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
      try {
        const operation = context.getNodeParameter('operation', itemIndex) as string;

        console.log(`\nHelius Webhook Node: Executing ${operation}`);

        switch (operation) {
          case 'create': {
            const webhookUrl = context.getNodeParameter('webhookUrl', itemIndex) as string;
            const accountAddressesStr = context.getNodeParameter(
              'accountAddresses',
              itemIndex,
            ) as string;
            const transactionTypesStr = context.getNodeParameter(
              'transactionTypes',
              itemIndex,
            ) as string;
            const webhookType = context.getNodeParameter('webhookType', itemIndex) as WebhookType;

            if (!webhookUrl) {
              throw new Error('Webhook URL is required');
            }
            if (!accountAddressesStr) {
              throw new Error('Account addresses are required');
            }

            const accountAddresses = accountAddressesStr.split(',').map((a) => a.trim());
            const transactionTypes = transactionTypesStr
              .split(',')
              .map((t) => t.trim()) as TransactionType[];

            const webhook = await this.createWebhook({
              apiKey: heliusApiKey,
              webhookUrl,
              accountAddresses,
              transactionTypes,
              webhookType,
            });

            console.log(`  Webhook created: ${webhook.webhookID}`);

            returnData.push({
              json: {
                success: true,
                operation: 'create',
                webhookId: webhook.webhookID,
                webhookUrl: webhook.webhookURL,
                accountAddresses: webhook.accountAddresses,
                transactionTypes: webhook.transactionTypes,
                webhookType: webhook.webhookType,
              },
            });
            break;
          }

          case 'get': {
            const webhookId = context.getNodeParameter('webhookId', itemIndex) as string;

            if (!webhookId) {
              throw new Error('Webhook ID is required');
            }

            const webhook = await this.getWebhook(heliusApiKey, webhookId);

            returnData.push({
              json: {
                success: true,
                operation: 'get',
                webhookId: webhook.webhookID,
                webhookUrl: webhook.webhookURL,
                accountAddresses: webhook.accountAddresses,
                transactionTypes: webhook.transactionTypes,
                webhookType: webhook.webhookType,
              },
            });
            break;
          }

          case 'delete': {
            const webhookId = context.getNodeParameter('webhookId', itemIndex) as string;

            if (!webhookId) {
              throw new Error('Webhook ID is required');
            }

            await this.deleteWebhook(heliusApiKey, webhookId);

            console.log(`  Webhook deleted: ${webhookId}`);

            returnData.push({
              json: {
                success: true,
                operation: 'delete',
                webhookId,
                message: 'Webhook deleted successfully',
              },
            });
            break;
          }

          case 'list': {
            const webhooks = await this.listWebhooks(heliusApiKey);

            console.log(`  Found ${webhooks.length} webhooks`);

            returnData.push({
              json: {
                success: true,
                operation: 'list',
                count: webhooks.length,
                webhooks: webhooks.map((w) => ({
                  webhookId: w.webhookID,
                  webhookUrl: w.webhookURL,
                  accountAddresses: w.accountAddresses,
                  transactionTypes: w.transactionTypes,
                  webhookType: w.webhookType,
                })),
              },
            });
            break;
          }

          default:
            throw new Error(`Unknown operation: ${operation}`);
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        returnData.push({
          json: {
            success: false,
            error: errorMessage,
            operation: context.getNodeParameter('operation', itemIndex),
          },
        });
      }
    }

    return [returnData];
  }

  /**
   * 創建 Webhook
   */
  private async createWebhook(params: {
    apiKey: string;
    webhookUrl: string;
    accountAddresses: string[];
    transactionTypes: TransactionType[];
    webhookType: WebhookType;
  }): Promise<HeliusWebhookResponse> {
    const { apiKey, webhookUrl, accountAddresses, transactionTypes, webhookType } = params;

    const response = await withRetry(() =>
      externalApiLimiter(() =>
        fetchWithTimeout(
          `https://api.helius.xyz/v0/webhooks?api-key=${apiKey}`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              webhookURL: webhookUrl,
              accountAddresses,
              transactionTypes,
              webhookType,
            }),
          },
          15000,
        ),
      ),
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(`Helius API error: ${errorData.error || response.statusText}`);
    }

    return response.json();
  }

  /**
   * 獲取 Webhook
   */
  private async getWebhook(apiKey: string, webhookId: string): Promise<HeliusWebhookResponse> {
    const response = await withRetry(() =>
      externalApiLimiter(() =>
        fetchWithTimeout(
          `https://api.helius.xyz/v0/webhooks/${webhookId}?api-key=${apiKey}`,
          {
            method: 'GET',
            headers: {
              'Content-Type': 'application/json',
            },
          },
          10000,
        ),
      ),
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(`Helius API error: ${errorData.error || response.statusText}`);
    }

    return response.json();
  }

  /**
   * 刪除 Webhook
   */
  private async deleteWebhook(apiKey: string, webhookId: string): Promise<void> {
    const response = await withRetry(() =>
      externalApiLimiter(() =>
        fetchWithTimeout(
          `https://api.helius.xyz/v0/webhooks/${webhookId}?api-key=${apiKey}`,
          {
            method: 'DELETE',
            headers: {
              'Content-Type': 'application/json',
            },
          },
          10000,
        ),
      ),
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(`Helius API error: ${errorData.error || response.statusText}`);
    }
  }

  /**
   * 列出所有 Webhooks
   */
  private async listWebhooks(apiKey: string): Promise<HeliusWebhookResponse[]> {
    const response = await withRetry(() =>
      externalApiLimiter(() =>
        fetchWithTimeout(
          `https://api.helius.xyz/v0/webhooks?api-key=${apiKey}`,
          {
            method: 'GET',
            headers: {
              'Content-Type': 'application/json',
            },
          },
          10000,
        ),
      ),
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(`Helius API error: ${errorData.error || response.statusText}`);
    }

    return response.json();
  }
}
