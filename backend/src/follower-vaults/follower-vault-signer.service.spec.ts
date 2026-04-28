import { Keypair } from '@solana/web3.js';
import { FollowerVaultSignerService } from './follower-vault-signer.service';
import { type KeeperKeypairService } from '../onchain/keeper-keypair.service';

const stubKeeper = (): KeeperKeypairService => {
  // Deterministic 32-byte seed so tests are reproducible.
  const seed = new Uint8Array(32);
  for (let i = 0; i < 32; i += 1) seed[i] = i + 1;
  const kp = Keypair.fromSeed(seed);
  return {
    loadKeypair: jest.fn().mockResolvedValue(kp),
    getResolvedSource: jest.fn().mockReturnValue('env'),
  } as unknown as KeeperKeypairService;
};

describe('FollowerVaultSignerService', () => {
  it('produces deterministic output for the same salt', async () => {
    const svc = new FollowerVaultSignerService(stubKeeper());
    const salt = svc.generateSalt();
    const a = await svc.derive(salt);
    const b = await svc.derive(salt);
    expect(a.pubkey).toEqual(b.pubkey);
    expect(a.derivationSalt).toEqual(salt);
  });

  it('produces different signers for different salts', async () => {
    const svc = new FollowerVaultSignerService(stubKeeper());
    const a = await svc.derive(svc.generateSalt());
    const b = await svc.derive(svc.generateSalt());
    expect(a.pubkey).not.toEqual(b.pubkey);
  });

  it('rejects empty or non-hex salts', async () => {
    const svc = new FollowerVaultSignerService(stubKeeper());
    await expect(svc.derive('')).rejects.toThrow();
    await expect(svc.derive('not-hex!!')).rejects.toThrow();
  });

  it('returns a 64-byte secret key suitable for @solana/web3.js Keypair', async () => {
    const svc = new FollowerVaultSignerService(stubKeeper());
    const sig = await svc.deriveFresh();
    expect(sig.secretKey.byteLength).toBe(64);
    // The pubkey must round-trip through Keypair.fromSecretKey.
    const round = Keypair.fromSecretKey(sig.secretKey);
    expect(round.publicKey.toBase58()).toEqual(sig.pubkey);
  });
});
