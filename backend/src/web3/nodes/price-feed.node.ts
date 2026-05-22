import { createHash } from 'crypto';
import { PublicKey } from '@solana/web3.js';
import {
  type INodeType,
  type IExecuteContext,
  type NodeExecutionData,
  type OnchainInstructionPayload,
} from '../workflow-types';
import { monitorPrice, TokenTicker } from '../utils/price-monitor';
import { Pyth_Price_Feed_ID } from '../constants';
import * as idlJsonModule from '../../onchain/anchor/pyth_price_feed_node.json';

// CJS vs ESM import shape — mirrors risk-guard.node.ts handling.
const idlJson = (idlJsonModule as any).default ?? idlJsonModule;

const PYTH_FEED_SEED = Buffer.from('pyth_feed');

/** Parse a Pyth feed id (32-byte hex, optional 0x) into a 32-byte Buffer. */
function feedIdToBytes(feedId: string): Buffer {
  const hex = feedId.startsWith('0x') ? feedId.slice(2) : feedId;
  if (hex.length !== 64 || !/^[0-9a-fA-F]+$/.test(hex)) {
    throw new Error(`pythPriceFeed: feedId must be 32-byte hex (64 chars), got "${feedId}"`);
  }
  return Buffer.from(hex, 'hex');
}

export class PriceFeedNode implements INodeType {
  description = {
    displayName: 'Pyth Price Feed',
    name: 'pythPriceFeed',
    group: ['trigger'],
    version: 1,
    description: 'Monitor token price and trigger workflow when target price is reached',
    inputs: ['main'],
    outputs: ['main'],
    telegramNotify: true,
    isTrigger: true,
    properties: [
      {
        displayName: 'Token Ticker',
        name: 'ticker',
        type: 'options' as const,
        default: '',
        description: 'Pyth price feed ID to monitor (e.g., SOL/USD feed ID)',
        options: Object.keys(Pyth_Price_Feed_ID).map((key) => ({
          name: key,
          value: key,
        })),
      },
      {
        displayName: 'Target Price',
        name: 'targetPrice',
        type: 'string' as const,
        default: '0',
        description: 'Target price to trigger the workflow',
      },
      {
        displayName: 'Condition',
        name: 'condition',
        type: 'options' as const,
        default: 'above',
        description: 'Price condition to trigger',
        options: [
          {
            name: 'Above',
            value: 'above',
          },
          {
            name: 'Below',
            value: 'below',
          },
          {
            name: 'Equal',
            value: 'equal',
          },
        ],
      },
      {
        displayName: 'Hermes Endpoint',
        name: 'hermesEndpoint',
        type: 'string' as const,
        default: 'https://hermes.pyth.network',
        description: 'Pyth Hermes endpoint URL',
      },
      {
        displayName: 'Feed ID (hex)',
        name: 'feedId',
        type: 'string' as const,
        default: '',
        description:
          '32-byte Pyth feed id (e.g. SOL/USD). Used to derive the on-chain PythFeedState PDA. Defaults to the resolved ticker feed id.',
      },
      {
        displayName: 'Caller Wallet',
        name: 'callerWallet',
        type: 'string' as const,
        default: '',
        description:
          'Wallet that owns the on-chain PythFeedState PDA. Defaults to the strategy creator.',
      },
      {
        displayName: 'Current Price (raw)',
        name: 'currentPriceRaw',
        type: 'number' as const,
        default: 0,
        description:
          'Latest price in raw Pyth units (apply exponent). Populated by the keeper from Hermes at runtime.',
        sensitive: true,
      },
      {
        displayName: 'Publish Time (unix)',
        name: 'publishTime',
        type: 'number' as const,
        default: 0,
        description: 'Pyth publish_time of the reading. Used for the on-chain staleness check.',
        sensitive: true,
      },
    ],
  };

  async execute(context: IExecuteContext): Promise<NodeExecutionData[][]> {
    const items = context.getInputData();
    const returnData: NodeExecutionData[] = [];

    for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
      try {
        // 獲取參數
        const ticker = context.getNodeParameter('priceId', itemIndex) as string;
        const targetPrice = parseFloat(
          context.getNodeParameter('targetPrice', itemIndex) as string,
        );
        const condition = context.getNodeParameter('condition', itemIndex) as
          | 'above'
          | 'below'
          | 'equal';
        const hermesEndpoint = context.getNodeParameter(
          'hermesEndpoint',
          itemIndex,
          'https://hermes.pyth.network',
        ) as string;

        // 使用可復用的 monitorPrice 工具函數
        const priceReached = await monitorPrice({
          ticker: ticker as TokenTicker,
          targetPrice,
          condition,
          hermesEndpoint,
          abortSignal: context.abortSignal,
          onPriceUpdate: (currentPrice) => {
            console.log(
              `Current price: ${currentPrice}, Target: ${targetPrice}, Condition: ${condition}`,
            );
          },
        });

        // 價格達到目標，觸發後續節點
        returnData.push({
          json: {
            success: true,
            triggered: priceReached.triggered,
            currentPrice: priceReached.currentPrice,
            targetPrice: priceReached.targetPrice,
            condition: priceReached.condition,
            ticker: priceReached.ticker,
            timestamp: priceReached.timestamp,
            message: `Price ${condition} ${targetPrice} reached at ${priceReached.currentPrice}`,
          },
        });
      } catch (error) {
        // 錯誤處理
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        returnData.push({
          json: {
            success: false,
            triggered: false,
            error: errorMessage,
            priceId: context.getNodeParameter('priceId', itemIndex),
            targetPrice: context.getNodeParameter('targetPrice', itemIndex),
            condition: context.getNodeParameter('condition', itemIndex),
          },
        });
      }
    }

    return [returnData];
  }

  /**
   * On-chain path — build a `pyth_price_feed_node.check_price` instruction the
   * keeper signs and submits when the node is classified as
   * `native_anchor_program`. The off-chain `execute()` above stays as a soft
   * fallback. The PythFeedState PDA must already exist (created by
   * `initialize_feed` at deploy time).
   */
  async buildOnchainInstruction(context: IExecuteContext): Promise<{
    instruction: OnchainInstructionPayload;
    explanation: string;
  }> {
    const programIdStr = (idlJson as { address: string }).address;
    const programId = new PublicKey(programIdStr);

    const callerWallet = context.getNodeParameter('callerWallet', 0) as string;
    if (!callerWallet) {
      throw new Error('pythPriceFeed.buildOnchainInstruction: callerWallet parameter is required');
    }
    const caller = new PublicKey(callerWallet);

    const ticker = context.getNodeParameter('ticker', 0) as string;
    const feedIdParam = (context.getNodeParameter('feedId', 0) as string) || '';
    const feedIdStr = feedIdParam || (Pyth_Price_Feed_ID as Record<string, string>)[ticker] || '';
    const feedIdBytes = feedIdToBytes(feedIdStr);

    const [feedPda] = PublicKey.findProgramAddressSync(
      [PYTH_FEED_SEED, caller.toBuffer(), feedIdBytes],
      programId,
    );

    const currentPrice = Number(context.getNodeParameter('currentPriceRaw', 0)) || 0;
    if (!Number.isInteger(currentPrice) || currentPrice <= 0) {
      throw new Error(
        `pythPriceFeed: currentPriceRaw must be a positive integer (raw units), got ${currentPrice}`,
      );
    }
    const publishTime = Number(context.getNodeParameter('publishTime', 0)) || 0;

    const discriminator = anchorMethodDiscriminator('check_price');
    const argBuf = Buffer.alloc(16);
    argBuf.writeBigInt64LE(BigInt(currentPrice), 0);
    argBuf.writeBigInt64LE(BigInt(publishTime), 8);
    const data = Buffer.concat([discriminator, argBuf]);

    return {
      instruction: {
        programId: programIdStr,
        accounts: [
          { pubkey: caller.toBase58(), isSigner: true, isWritable: false },
          { pubkey: feedPda.toBase58(), isSigner: false, isWritable: true },
        ],
        dataBase64: data.toString('base64'),
      },
      explanation: `pyth_price_feed_node.check_price(${currentPrice}@${publishTime}) on feed=${feedPda.toBase58()}`,
    };
  }
}

/** Anchor method discriminator = sha256("global:<snake_case>")[..8] */
function anchorMethodDiscriminator(name: string): Buffer {
  return createHash('sha256').update(`global:${name}`).digest().subarray(0, 8);
}
