import { PublicKey } from '@solana/web3.js';

const DELEGATION_PROGRAM_ID = new PublicKey('DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh');
const strategyStatePda = new PublicKey('5JVtJfNk2XZzMEbfKSRYyULPUjyoTnB9DF8FZ4gdoh3i');

const [record] = PublicKey.findProgramAddressSync(
  [Buffer.from('delegation'), strategyStatePda.toBuffer()],
  DELEGATION_PROGRAM_ID,
);
const [metadata] = PublicKey.findProgramAddressSync(
  [Buffer.from('delegation-metadata'), strategyStatePda.toBuffer()],
  DELEGATION_PROGRAM_ID,
);

console.log('Delegation Record:', record.toBase58());
console.log('Delegation Metadata:', metadata.toBase58());
