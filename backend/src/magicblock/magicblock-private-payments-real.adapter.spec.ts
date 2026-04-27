import { MagicBlockPrivatePaymentsClientService } from './magicblock-private-payments-client.service';
import { MagicBlockPrivatePaymentsRealAdapter } from './magicblock-private-payments-real.adapter';

const buildClient = () =>
  ({
    post: jest.fn(),
    get: jest.fn(),
  }) as unknown as MagicBlockPrivatePaymentsClientService & {
    post: jest.Mock;
    get: jest.Mock;
  };

describe('MagicBlockPrivatePaymentsRealAdapter', () => {
  it('deposit POSTs to /v1/spl/deposit with owner/mint/amount', async () => {
    const client = buildClient();
    client.post.mockResolvedValue({
      kind: 'deposit',
      version: 'legacy',
      transactionBase64: 'tx-b64',
      sendTo: 'base',
      recentBlockhash: 'bh',
      lastValidBlockHeight: 123,
      instructionCount: 2,
      requiredSigners: ['s1'],
    });
    const adapter = new MagicBlockPrivatePaymentsRealAdapter(client);
    const res = await adapter.deposit({
      deploymentId: 'd1',
      fromWallet: 'w1',
      mint: 'm1',
      amount: '100',
    });
    expect(res.transactionBase64).toBe('tx-b64');
    expect(client.post).toHaveBeenCalledWith('/v1/spl/deposit', {
      owner: 'w1',
      mint: 'm1',
      amount: 100,
    });
  });

  it('transfer POSTs to /v1/spl/transfer with owner/destination/mint/amount', async () => {
    const client = buildClient();
    client.post.mockResolvedValue({
      kind: 'transfer',
      version: 'legacy',
      transactionBase64: 'tx-t',
      sendTo: 'ephemeral',
      recentBlockhash: 'bh2',
      lastValidBlockHeight: 456,
      instructionCount: 1,
      requiredSigners: ['s2'],
    });
    const adapter = new MagicBlockPrivatePaymentsRealAdapter(client);
    const res = await adapter.transfer({
      deploymentId: 'd1',
      fromWallet: 'w1',
      toWallet: 'w2',
      mint: 'm1',
      amount: '5',
    });
    expect(res.kind).toBe('transfer');
    expect(client.post).toHaveBeenCalledWith('/v1/spl/transfer', {
      owner: 'w1',
      destination: 'w2',
      mint: 'm1',
      amount: 5,
    });
  });

  it('withdraw POSTs to /v1/spl/withdraw with owner/mint/amount', async () => {
    const client = buildClient();
    client.post.mockResolvedValue({
      kind: 'withdraw',
      version: 'legacy',
      transactionBase64: 'tx-w',
      sendTo: 'base',
      recentBlockhash: 'bh3',
      lastValidBlockHeight: 789,
      instructionCount: 1,
      requiredSigners: ['s3'],
    });
    const adapter = new MagicBlockPrivatePaymentsRealAdapter(client);
    const res = await adapter.withdraw({
      deploymentId: 'd1',
      toWallet: 'w2',
      mint: 'm1',
      amount: '7',
    });
    expect(res.kind).toBe('withdraw');
    expect(client.post).toHaveBeenCalledWith('/v1/spl/withdraw', {
      owner: 'w2',
      mint: 'm1',
      amount: 7,
    });
  });

  it('rejects non-integer amount', async () => {
    const adapter = new MagicBlockPrivatePaymentsRealAdapter(buildClient());
    await expect(
      adapter.deposit({ deploymentId: 'd1', fromWallet: 'w1', mint: 'm1', amount: '1.5' }),
    ).rejects.toThrow('Invalid PP amount');
  });

  it('getBalance hits /v1/spl/balance with owner/mint and returns balance/decimals', async () => {
    const client = buildClient();
    client.get.mockResolvedValue({ balance: '1000', decimals: 6 });
    const adapter = new MagicBlockPrivatePaymentsRealAdapter(client);
    const res = await adapter.getBalance({ deploymentId: 'd1', wallet: 'w1', mint: 'm1' });
    expect(res).toEqual({ balance: '1000', decimals: 6 });
    expect(client.get).toHaveBeenCalledWith('/v1/spl/balance', {
      owner: 'w1',
      mint: 'm1',
    });
  });

  it('returns zero defaults when balance remote is empty', async () => {
    const client = buildClient();
    client.get.mockResolvedValue({});
    const adapter = new MagicBlockPrivatePaymentsRealAdapter(client);
    const res = await adapter.getBalance({ deploymentId: 'd1', wallet: 'w1', mint: 'm1' });
    expect(res).toEqual({ balance: '0', decimals: 0 });
  });
});
