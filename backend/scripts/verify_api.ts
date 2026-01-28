import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import * as nacl from 'tweetnacl';
import bs58 from 'bs58';
import axios from 'axios';

const API_URL = 'http://localhost:3000/api'; // Global prefix is 'api'

async function main() {
  console.log('🚀 Starting Crossmint API Verification...');

  // 1. Generate a random wallet (Owner)
  const ownerKeypair = Keypair.generate();
  const walletAddress = ownerKeypair.publicKey.toBase58();
  console.log(`👤 Generated Test Wallet: ${walletAddress}`);

  // 2. Request Challenge
  console.log('\n📝 Requesting Challenge...');
  let challenge: string;
  try {
    const res = await axios.post(`${API_URL}/auth/challenge`, { walletAddress });
    challenge = res.data.data.challenge;
    console.log(`✅ Challenge Received: "${challenge.substring(0, 30)}..."`);
  } catch (error) {
    console.error('❌ Failed to get challenge:', error.response?.data || error.message);
    process.exit(1);
  }

  // 3. Sign Challenge
  console.log('\n✍️ Signing Challenge...');
  const messageBytes = new TextEncoder().encode(challenge);
  const signatureBytes = nacl.sign.detached(messageBytes, ownerKeypair.secretKey);
  const signature = bs58.encode(signatureBytes);
  console.log(`✅ Signature Generated: ${signature.substring(0, 20)}...`);

  // 4. Call Init Wallet
  console.log('\n🔧 Initializing Crossmint Wallet (API Call)...');
  let accountId: string;
  try {
    const res = await axios.post(`${API_URL}/crossmint/wallets/init`, {
        walletAddress,
        signature,
        accountName: 'Test Automation Account'
    });
    console.log('✅ Wallet Initialized Successfully!');
    console.log('📦 Response:', res.data);
    accountId = res.data.id;
  } catch (error) {
    console.error('❌ Failed to init wallet:', error.response?.data || error.message);
    if (error.response?.data?.message === 'Invalid signature or challenge expired') {
        console.error('⚠️ Note: Challenge might have been consumed or expired improperly?');
    }
    process.exit(1);
  }

  // 5. Test Delete (Archiving)
  console.log(`\n🗑️ Deleting (Archiving) Account: ${accountId}`);
  
  // Need a NEW challenge because the previous one was consumed!
  console.log('📝 Requesting NEW Challenge for Delete...');
  const res2 = await axios.post(`${API_URL}/auth/challenge`, { walletAddress });
  const challenge2 = res2.data.data.challenge;
  
  const messageBytes2 = new TextEncoder().encode(challenge2);
  const signatureBytes2 = nacl.sign.detached(messageBytes2, ownerKeypair.secretKey);
  const signature2 = bs58.encode(signatureBytes2);

  try {
    const res = await axios.delete(`${API_URL}/crossmint/wallets/${accountId}`, {
        data: {
            walletAddress,
            signature: signature2
        }
    });
    console.log('✅ Wallet Deleted (Archived) Successfully!');
    console.log('📦 Response:', res.data);
  } catch (error) {
    console.error('❌ Failed to delete wallet:', error.response?.data || error.message);
    process.exit(1);
  }

  console.log('\n✨ Verification Complete: All tests passed.');
}

main().catch(console.error);
