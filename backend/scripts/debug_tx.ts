import { Connection, Keypair, PublicKey, SystemProgram, Transaction } from '@solana/web3.js';
import { AnchorProvider, Program, Wallet, BN } from '@anchor-lang/core';
import * as fs from 'fs';
import * as path from 'path';

const walletPath = path.resolve(__dirname, '../../programs/tests/devnet/test-wallet.json');
const walletSecret = JSON.parse(fs.readFileSync(walletPath, 'utf-8'));
const wallet = Keypair.fromSecretKey(Uint8Array.from(walletSecret));
const PROGRAM_ID = new PublicKey('FBh8hmjZYZhrhi1ionZHCVxrBbjn6s9oSGnSu3gV4vkF');
const idlPath = path.resolve(__dirname, '../src/onchain/anchor/strategy_runtime.json');
const idlJson = JSON.parse(fs.readFileSync(idlPath, 'utf-8'));
const idl = { ...idlJson, address: PROGRAM_ID.toBase58() };
const provider = new AnchorProvider(new Connection('https://api.devnet.solana.com'), new Wallet(wallet), { commitment: 'confirmed' });
const program = new Program(idl as any, provider);

async function main() {
  const deploymentPda = new PublicKey('DUwwTVhUmnNwyMdBxCj5BQaV2mujSnuRX5DNZu494VY2');
  const strategyStatePda = new PublicKey('9Gf2jpe7CTRWYx5KitigJNj15NcKXrn2DWgXPLkFWpSR');
  
  const ix = await program.methods
    .commitState(0, Array.from(Buffer.from('c'.repeat(64), 'hex')), 0)
    .accountsPartial({ creator: wallet.publicKey, deployment: deploymentPda, strategyState: strategyStatePda })
    .instruction();
    
  console.log('Program ID:', ix.programId.toBase58());
  console.log('Keys:');
  ix.keys.forEach((k, i) => {
    console.log(`  [${i}] ${k.pubkey.toBase58()} signer=${k.isSigner} writable=${k.isWritable}`);
  });
}
main();
