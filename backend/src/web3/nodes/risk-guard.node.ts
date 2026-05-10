import { createHash } from 'crypto';
import { PublicKey } from '@solana/web3.js';
import {
  type IExecuteContext,
  type INodeType,
  type NodeExecutionData,
  type OnchainInstructionPayload,
} from '../workflow-types';
import * as idlJsonModule from '../../onchain/anchor/risk_guard_node.json';

// CJS vs ESM import shape — mirrors anchor-client.service.ts handling.
const idlJson = (idlJsonModule as any).default ?? idlJsonModule;

const GUARD_SEED = Buffer.from('risk_guard');

/**
 * Risk Guard — on-chain drawdown guard backed by the `risk_guard_node`
 * Anchor program. Off-chain `execute()` is a soft fallback only; the
 * normal execution path is `buildOnchainInstruction()` returning a
 * `check_drawdown` instruction the keeper signs and submits.
 */
export class RiskGuardNode implements INodeType {
  description = {
    displayName: 'Risk Guard',
    name: 'riskGuard',
    group: ['guard'],
    version: 1,
    description:
      'On-chain drawdown guard. Freezes the strategy when current drawdown exceeds the configured max threshold.',
    inputs: ['main'],
    outputs: ['main'],
    telegramNotify: true,
    isTrigger: false,
    properties: [
      {
        displayName: 'Max Allowed Drawdown (bps)',
        name: 'maxAllowedBps',
        type: 'number' as const,
        default: 1500,
        description:
          'Freeze the guard when current drawdown exceeds this (1500 = 15%). Set during initialize_guard.',
        sensitive: true,
      },
      {
        displayName: 'Current Drawdown (bps)',
        name: 'currentDrawdownBps',
        type: 'number' as const,
        default: 0,
        description: 'Current drawdown read from the upstream metrics node.',
        sensitive: true,
      },
      {
        displayName: 'Caller Wallet',
        name: 'callerWallet',
        type: 'string' as const,
        default: '',
        description:
          'Wallet that owns the on-chain GuardState PDA. Defaults to the strategy creator.',
      },
    ],
  };

  /**
   * Off-chain stub — the keeper SHOULD route through buildOnchainInstruction()
   * when the strategy is classified as `native_anchor_program`. This
   * fallback is here so legacy off-chain executions or tests don't crash;
   * it returns the same trip / not-tripped signal but never persists state.
   */
  async execute(context: IExecuteContext): Promise<NodeExecutionData[][]> {
    const current = Number(context.getNodeParameter('currentDrawdownBps', 0)) || 0;
    const max = Number(context.getNodeParameter('maxAllowedBps', 0)) || 1500;
    const tripped = current > max;
    return [
      [
        {
          json: {
            success: !tripped,
            tripped,
            currentDrawdownBps: current,
            maxAllowedBps: max,
            note: 'off-chain fallback — on-chain risk_guard_node not invoked',
          },
        },
      ],
    ];
  }

  async buildOnchainInstruction(context: IExecuteContext): Promise<{
    instruction: OnchainInstructionPayload;
    explanation: string;
  }> {
    const programIdStr = (idlJson as { address: string }).address;
    const programId = new PublicKey(programIdStr);
    const callerWallet = context.getNodeParameter('callerWallet', 0) as string;
    if (!callerWallet) {
      throw new Error('riskGuard.buildOnchainInstruction: callerWallet parameter is required');
    }
    const caller = new PublicKey(callerWallet);
    const [guardPda] = PublicKey.findProgramAddressSync([GUARD_SEED, caller.toBuffer()], programId);
    const currentBps = Number(context.getNodeParameter('currentDrawdownBps', 0)) || 0;
    if (!Number.isInteger(currentBps) || currentBps < 0 || currentBps > 0xffff) {
      throw new Error(
        `riskGuard: currentDrawdownBps must be an integer in [0, 65535], got ${currentBps}`,
      );
    }

    const discriminator = anchorMethodDiscriminator('check_drawdown');
    const argBuf = Buffer.alloc(2);
    argBuf.writeUInt16LE(currentBps, 0);
    const data = Buffer.concat([discriminator, argBuf]);

    return {
      instruction: {
        programId: programIdStr,
        accounts: [
          { pubkey: caller.toBase58(), isSigner: true, isWritable: false },
          { pubkey: guardPda.toBase58(), isSigner: false, isWritable: true },
        ],
        dataBase64: data.toString('base64'),
      },
      explanation: `risk_guard_node.check_drawdown(${currentBps}bps) on guard=${guardPda.toBase58()}`,
    };
  }
}

/** Anchor method discriminator = sha256("global:<snake_case>")[..8] */
function anchorMethodDiscriminator(name: string): Buffer {
  return createHash('sha256').update(`global:${name}`).digest().subarray(0, 8);
}
