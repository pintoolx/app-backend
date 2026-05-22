import { createHash } from 'crypto';
import { PublicKey } from '@solana/web3.js';
import { PriceFeedNode } from './price-feed.node';
import * as idlJsonModule from '../../onchain/anchor/pyth_price_feed_node.json';

const idlJson = (idlJsonModule as any).default ?? idlJsonModule;
const PROGRAM_ID = (idlJson as { address: string }).address;
const PYTH_FEED_SEED = Buffer.from('pyth_feed');

// SOL/USD feed id (32-byte hex). Any valid 64-char hex works for these tests.
const FEED_ID = '0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d';
const WALLET = '11111111111111111111111111111112';

function feedIdBytes(feedId: string): Buffer {
  return Buffer.from(feedId.replace(/^0x/, ''), 'hex');
}

function fakeCtx(params: Record<string, unknown>) {
  return {
    getInputData: () => [],
    getNodeParameter: (name: string, _idx: number, def?: unknown) => params[name] ?? def,
    getWorkflowStaticData: () => ({}),
    helpers: { returnJsonArray: (_: unknown[]) => [] },
  } as any;
}

describe('PriceFeedNode', () => {
  const node = new PriceFeedNode();

  it('buildOnchainInstruction targets the registered program ID', async () => {
    const built = await node.buildOnchainInstruction!(
      fakeCtx({ feedId: FEED_ID, callerWallet: WALLET, currentPriceRaw: 8_000_000_000, publishTime: 1 }),
    );
    expect(built.instruction.programId).toBe(PROGRAM_ID);
  });

  it('buildOnchainInstruction derives the correct feed PDA from caller + feed_id', async () => {
    const built = await node.buildOnchainInstruction!(
      fakeCtx({ feedId: FEED_ID, callerWallet: WALLET, currentPriceRaw: 8_000_000_000, publishTime: 1 }),
    );
    const [expected] = PublicKey.findProgramAddressSync(
      [PYTH_FEED_SEED, new PublicKey(WALLET).toBuffer(), feedIdBytes(FEED_ID)],
      new PublicKey(PROGRAM_ID),
    );
    const feedAccount = built.instruction.accounts[1];
    expect(feedAccount.pubkey).toBe(expected.toBase58());
    expect(feedAccount.isWritable).toBe(true);
    expect(feedAccount.isSigner).toBe(false);
  });

  it('caller account is the signer and is not writable', async () => {
    const built = await node.buildOnchainInstruction!(
      fakeCtx({ feedId: FEED_ID, callerWallet: WALLET, currentPriceRaw: 100, publishTime: 1 }),
    );
    const caller = built.instruction.accounts[0];
    expect(caller.pubkey).toBe(WALLET);
    expect(caller.isSigner).toBe(true);
    expect(caller.isWritable).toBe(false);
  });

  it('buildOnchainInstruction uses Anchor discriminator + two LE i64 args', async () => {
    const built = await node.buildOnchainInstruction!(
      fakeCtx({ feedId: FEED_ID, callerWallet: WALLET, currentPriceRaw: 8_000_000_000, publishTime: 1717000000 }),
    );
    const data = Buffer.from(built.instruction.dataBase64, 'base64');
    const expectedDisc = createHash('sha256').update('global:check_price').digest().subarray(0, 8);
    expect(data.subarray(0, 8).equals(expectedDisc)).toBe(true);
    expect(data.subarray(8).readBigInt64LE(0)).toBe(8_000_000_000n);
    expect(data.subarray(8).readBigInt64LE(8)).toBe(1717000000n);
  });

  it('throws when callerWallet is missing', async () => {
    await expect(
      node.buildOnchainInstruction!(fakeCtx({ feedId: FEED_ID, currentPriceRaw: 100, publishTime: 1 })),
    ).rejects.toThrow(/callerWallet/);
  });

  it('throws when feedId is not 32-byte hex', async () => {
    await expect(
      node.buildOnchainInstruction!(
        fakeCtx({ feedId: '0xdeadbeef', callerWallet: WALLET, currentPriceRaw: 100, publishTime: 1 }),
      ),
    ).rejects.toThrow(/feedId/);
  });

  it('rejects non-positive current price', async () => {
    await expect(
      node.buildOnchainInstruction!(
        fakeCtx({ feedId: FEED_ID, callerWallet: WALLET, currentPriceRaw: 0, publishTime: 1 }),
      ),
    ).rejects.toThrow(/currentPriceRaw/);
  });
});
