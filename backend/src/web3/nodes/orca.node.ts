import { type INodeType, type IExecuteContext, type NodeExecutionData } from '../workflow-types';

/**
 * Orca DEX swap primitive — surfaces in the Workflow Canvas primitive
 * library next to Jupiter/Pyth/Kamino. The runtime executor is a stub for
 * now: native Orca routing is planned but the demo only requires the
 * primitive to be discoverable + classifiable. Real strategies should keep
 * using `jupiterSwap` until Orca routing is implemented.
 */
export class OrcaNode implements INodeType {
  description = {
    displayName: 'Orca',
    name: 'orcaSwap',
    group: ['swap'],
    version: 1,
    description: 'Swap tokens using Orca whirlpools (concentrated liquidity DEX on Solana)',
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
        description: 'Account ID to use for the swap (uses Crossmint custodial wallet)',
      },
      {
        displayName: 'Input Token',
        name: 'inputToken',
        type: 'string' as const,
        default: 'USDC',
        description: 'Input token ticker (e.g., USDC, SOL, JITOSOL).',
      },
      {
        displayName: 'Output Token',
        name: 'outputToken',
        type: 'string' as const,
        default: 'SOL',
        description: 'Output token ticker (e.g., SOL, USDC, JITOSOL).',
      },
      {
        displayName: 'Amount',
        name: 'amount',
        type: 'string' as const,
        default: 'auto',
        description: 'Amount to swap. "auto" = output of previous node, or specify a number.',
        sensitive: true,
      },
      {
        displayName: 'Slippage (bps)',
        name: 'slippageBps',
        type: 'string' as const,
        default: '50',
        description: 'Slippage tolerance in basis points (50 = 0.5%)',
        sensitive: true,
      },
    ],
  };

  async execute(_context: IExecuteContext): Promise<NodeExecutionData[][]> {
    throw new Error(
      'OrcaNode runtime not implemented yet. Use jupiterSwap until Orca routing ships.',
    );
  }
}
