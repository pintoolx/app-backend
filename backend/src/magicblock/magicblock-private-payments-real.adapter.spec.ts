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
  it('deposit POSTs to /v1/deposit and normalizes the response', async () => {
    const client = buildClient();
    client.post.mockResolvedValue({
      signature: 'sig1',
      status: 'pending',
      encryptedBalanceRef: 'er1',
    });
    const adapter = new MagicBlockPrivatePaymentsRealAdapter(client);
    const res = await adapter.deposit({
      deploymentId: 'd1',
      fromWallet: 'w1',
      mint: 'm1',
      amount: '100',
    });
    expect(res).toEqual({ signature: 'sig1', status: 'pending', encryptedBalanceRef: 'er1' });
    expect(client.post).toHaveBeenCalledWith(
      '/v1/deposit',
      expect.objectContaining({ deploymentId: 'd1', fromWallet: 'w1' }),
    );
  });

  it('transfer POSTs to /v1/transfer', async () => {
    const client = buildClient();
    client.post.mockResolvedValue({ signature: 'sigT', status: 'confirmed' });
    const adapter = new MagicBlockPrivatePaymentsRealAdapter(client);
    const res = await adapter.transfer({
      deploymentId: 'd1',
      fromWallet: 'w1',
      toWallet: 'w2',
      mint: 'm1',
      amount: '5',
    });
    expect(res.status).toBe('confirmed');
    expect(client.post).toHaveBeenCalledWith(
      '/v1/transfer',
      expect.objectContaining({ toWallet: 'w2' }),
    );
  });

  it('withdraw POSTs to /v1/withdraw', async () => {
    const client = buildClient();
    client.post.mockResolvedValue({});
    const adapter = new MagicBlockPrivatePaymentsRealAdapter(client);
    const res = await adapter.withdraw({
      deploymentId: 'd1',
      toWallet: 'w2',
      mint: 'm1',
      amount: '7',
    });
    expect(res).toEqual({ signature: null, status: 'pending', encryptedBalanceRef: null });
  });

  it('getBalance hits /v1/balance and returns encrypted refs', async () => {
    const client = buildClient();
    client.get.mockResolvedValue({ encryptedBalanceRef: 'er1', ciphertext: 'cipher' });
    const adapter = new MagicBlockPrivatePaymentsRealAdapter(client);
    const res = await adapter.getBalance({ deploymentId: 'd1', wallet: 'w1', mint: 'm1' });
    expect(res).toEqual({ encryptedBalanceRef: 'er1', ciphertext: 'cipher' });
    expect(client.get).toHaveBeenCalledWith('/v1/balance', {
      deploymentId: 'd1',
      wallet: 'w1',
      mint: 'm1',
    });
  });

  it('returns failed status when the remote throws', async () => {
    const client = buildClient();
    client.post.mockRejectedValue(new Error('network down'));
    const adapter = new MagicBlockPrivatePaymentsRealAdapter(client);
    const res = await adapter.deposit({
      deploymentId: 'd1',
      fromWallet: 'w1',
      mint: 'm1',
      amount: '1',
    });
    expect(res).toEqual({ signature: null, status: 'failed', encryptedBalanceRef: null });
  });
});
