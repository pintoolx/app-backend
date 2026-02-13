import { INodeType } from '../workflow-types';

/**
 * Node Registry - 自動收集所有 node 類型
 * 新增 node 時只需要在此檔案 import 並加入 registry
 */
const NODE_REGISTRY: Map<string, () => INodeType> = new Map();

/**
 * 註冊一個 node 類型到全域 registry
 */
export function registerNode(name: string, factory: () => INodeType): void {
  NODE_REGISTRY.set(name, factory);
}

/**
 * 取得所有已註冊的 node
 */
export function getRegisteredNodes(): Map<string, () => INodeType> {
  return NODE_REGISTRY;
}

// --- 註冊所有 nodes ---
import { PriceFeedNode } from './price-feed.node';
import { SwapNode } from './swap.node';
import { KaminoNode } from './kamino.node';
import { TransferNode } from './transfer.node';
import { BalanceNode } from './balance.node';
import { LimitOrderNode } from './limit-order.node';
import { LuloNode } from './lulo.node';
import { StakeNode } from './stake.node';
import { DriftNode } from './drift.node';
import { SanctumNode } from './sanctum.node';
import { HeliusWebhookNode } from './helius-webhook.node';

registerNode('pythPriceFeed', () => new PriceFeedNode());
registerNode('jupiterSwap', () => new SwapNode());
registerNode('kamino', () => new KaminoNode());
registerNode('transfer', () => new TransferNode());
registerNode('getBalance', () => new BalanceNode());
registerNode('jupiterLimitOrder', () => new LimitOrderNode());
registerNode('luloLend', () => new LuloNode());
registerNode('stakeSOL', () => new StakeNode());
registerNode('driftPerp', () => new DriftNode());
registerNode('sanctumLst', () => new SanctumNode());
registerNode('heliusWebhook', () => new HeliusWebhookNode());
