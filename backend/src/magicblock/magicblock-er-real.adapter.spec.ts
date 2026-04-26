import { BadRequestException } from '@nestjs/common';
import { MagicBlockClientService } from './magicblock-client.service';
import { MagicBlockErRealAdapter } from './magicblock-er-real.adapter';

const buildClientStub = () => {
  const stub: Partial<MagicBlockClientService> = {
    submitBase64Transaction: jest.fn(),
  };
  return stub as MagicBlockClientService & {
    submitBase64Transaction: jest.Mock;
  };
};

describe('MagicBlockErRealAdapter', () => {
  it('delegateAccount returns advisory session when no signed tx is provided', async () => {
    const client = buildClientStub();
    const adapter = new MagicBlockErRealAdapter(client);
    const res = await adapter.delegateAccount({
      deploymentId: 'depl-1',
      accountPubkey: 'pk',
    });
    expect(res.signature).toBeNull();
    expect(res.sessionId).toBe('er-advisory-depl-1');
    expect(client.submitBase64Transaction).not.toHaveBeenCalled();
  });

  it('delegateAccount forwards signed tx and returns the signature as session', async () => {
    const client = buildClientStub();
    client.submitBase64Transaction.mockResolvedValue('sig-delegate');
    const adapter = new MagicBlockErRealAdapter(client);
    const res = await adapter.delegateAccount({
      deploymentId: 'depl-2',
      accountPubkey: 'pk',
      signedTxBase64: 'AAAA',
    });
    expect(res).toEqual({ sessionId: 'sig-delegate', signature: 'sig-delegate' });
  });

  it('route forwards through Magic Router', async () => {
    const client = buildClientStub();
    client.submitBase64Transaction.mockResolvedValue('sig-route');
    const adapter = new MagicBlockErRealAdapter(client);
    const res = await adapter.route({ deploymentId: 'depl-3', base64Tx: 'AAAA' });
    expect(res).toEqual({ signature: 'sig-route', routedThrough: 'er' });
  });

  it('route rejects empty payload', async () => {
    const client = buildClientStub();
    const adapter = new MagicBlockErRealAdapter(client);
    await expect(adapter.route({ deploymentId: 'depl-3', base64Tx: '' })).rejects.toThrow(
      BadRequestException,
    );
  });

  it('commitAndUndelegate is advisory without a signed tx', async () => {
    const client = buildClientStub();
    const adapter = new MagicBlockErRealAdapter(client);
    const res = await adapter.commitAndUndelegate({
      deploymentId: 'depl-4',
      accountPubkey: 'pk',
    });
    expect(res.signature).toBeNull();
    expect(client.submitBase64Transaction).not.toHaveBeenCalled();
  });

  it('commitAndUndelegate forwards a signed tx', async () => {
    const client = buildClientStub();
    client.submitBase64Transaction.mockResolvedValue('sig-undelegate');
    const adapter = new MagicBlockErRealAdapter(client);
    const res = await adapter.commitAndUndelegate({
      deploymentId: 'depl-5',
      accountPubkey: 'pk',
      signedTxBase64: 'AAAA',
    });
    expect(res).toEqual({ signature: 'sig-undelegate' });
  });
});
