import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";

export const DEVNET_RPC = "https://api.devnet.solana.com";

export function getDevnetWallet(): Keypair {
  const walletPath = path.join(__dirname, "test-wallet.json");
  const secretKey = Uint8Array.from(JSON.parse(fs.readFileSync(walletPath, "utf-8")));
  return Keypair.fromSecretKey(secretKey);
}

export async function ensureDevnetBalance(
  connection: Connection,
  pubkey: PublicKey,
  minSol = 2,
): Promise<void> {
  const balance = await connection.getBalance(pubkey);
  if (balance < minSol * LAMPORTS_PER_SOL) {
    console.log(`Requesting airdrop for ${pubkey.toBase58()}...`);
    try {
      await connection.requestAirdrop(pubkey, 2 * LAMPORTS_PER_SOL);
      // Wait for confirmation
      let retries = 30;
      while (retries-- > 0) {
        await new Promise((r) => setTimeout(r, 1000));
        const newBalance = await connection.getBalance(pubkey);
        if (newBalance >= minSol * LAMPORTS_PER_SOL) break;
      }
    } catch (err) {
      console.warn("Devnet airdrop failed:", err);
    }
  }
}

export async function retry<T>(
  fn: () => Promise<T>,
  retries = 5,
  delay = 2000,
): Promise<T> {
  let lastErr: any;
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      console.warn(`Retry ${i + 1}/${retries} failed, waiting ${delay}ms...`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

export function randomBytes(n: number): Buffer {
  return Buffer.from(Keypair.generate().publicKey.toBytes().slice(0, n));
}

export function u32LE(value: number): Buffer {
  const buf = Buffer.alloc(4);
  buf.writeUInt32LE(value, 0);
  return buf;
}

export const PROGRAM_ID_DEVNET = new PublicKey("FBh8hmjZYZhrhi1ionZHCVxrBbjn6s9oSGnSu3gV4vkF");
