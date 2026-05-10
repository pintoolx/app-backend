import { createHash } from 'crypto';
import { PublicKey } from '@solana/web3.js';
import { RiskGuardNode } from './risk-guard.node';
import * as idlJsonModule from '../../onchain/anchor/risk_guard_node.json';

const idlJson = (idlJsonModule as any).default ?? idlJsonModule;
const PROGRAM_ID = (idlJson as { address: string }).address;
const GUARD_SEED = Buffer.from('risk_guard');

function fakeCtx(params: Record<string, unknown>) {
  return {
    getInputData: () => [],
    getNodeParameter: (name: string, _idx: number, def?: unknown) => params[name] ?? def,
    getWorkflowStaticData: () => ({}),
    helpers: { returnJsonArray: (_: unknown[]) => [] },
  } as any;
}

describe('RiskGuardNode', () => {
  const node = new RiskGuardNode();

  it('off-chain execute() returns tripped=false when current <= max', async () => {
    const r = await node.execute(fakeCtx({ currentDrawdownBps: 800, maxAllowedBps: 1500 }));
    expect(r[0][0].json).toMatchObject({ success: true, tripped: false });
  });

  it('off-chain execute() returns tripped=true when current > max', async () => {
    const r = await node.execute(fakeCtx({ currentDrawdownBps: 1700, maxAllowedBps: 1500 }));
    expect(r[0][0].json).toMatchObject({ success: false, tripped: true });
  });

  it('buildOnchainInstruction targets the registered program ID', async () => {
    const wallet = '11111111111111111111111111111112';
    const built = await node.buildOnchainInstruction!(
      fakeCtx({ currentDrawdownBps: 100, callerWallet: wallet }),
    );
    expect(built.instruction.programId).toBe(PROGRAM_ID);
  });

  it('buildOnchainInstruction derives the correct guard PDA', async () => {
    const wallet = '11111111111111111111111111111112';
    const built = await node.buildOnchainInstruction!(
      fakeCtx({ currentDrawdownBps: 100, callerWallet: wallet }),
    );
    const [expected] = PublicKey.findProgramAddressSync(
      [GUARD_SEED, new PublicKey(wallet).toBuffer()],
      new PublicKey(PROGRAM_ID),
    );
    const guardAccount = built.instruction.accounts[1];
    expect(guardAccount.pubkey).toBe(expected.toBase58());
    expect(guardAccount.isWritable).toBe(true);
    expect(guardAccount.isSigner).toBe(false);
  });

  it('buildOnchainInstruction uses Anchor discriminator + LE u16 args', async () => {
    const wallet = '11111111111111111111111111111112';
    const built = await node.buildOnchainInstruction!(
      fakeCtx({ currentDrawdownBps: 1234, callerWallet: wallet }),
    );
    const data = Buffer.from(built.instruction.dataBase64, 'base64');
    const expectedDisc = createHash('sha256')
      .update('global:check_drawdown')
      .digest()
      .subarray(0, 8);
    expect(data.subarray(0, 8).equals(expectedDisc)).toBe(true);
    const arg = data.subarray(8).readUInt16LE(0);
    expect(arg).toBe(1234);
  });

  it('buildOnchainInstruction throws when callerWallet is missing', async () => {
    await expect(
      node.buildOnchainInstruction!(fakeCtx({ currentDrawdownBps: 100 })),
    ).rejects.toThrow(/callerWallet/);
  });

  it('buildOnchainInstruction rejects out-of-range bps', async () => {
    await expect(
      node.buildOnchainInstruction!(
        fakeCtx({ currentDrawdownBps: 70000, callerWallet: '11111111111111111111111111111112' }),
      ),
    ).rejects.toThrow(/currentDrawdownBps/);
  });
});
