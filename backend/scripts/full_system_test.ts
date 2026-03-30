import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as nacl from 'tweetnacl';
import bs58 from 'bs58';
import axios from 'axios';
import { Keypair } from '@solana/web3.js';

dotenv.config();

const API_URL = 'http://localhost:3000/api';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing Supabase env vars');
  process.exit(1);
}

const adminSupabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

let testKeyPair: Keypair;
let walletAddress: string;
let accountId: string;
let workflowId: string;
let apiKey: string;

async function createSignedChallenge(targetWalletAddress: string, signer: Keypair) {
  const challengeRes = await axios.post(`${API_URL}/auth/challenge`, {
    walletAddress: targetWalletAddress,
  });
  const challenge = challengeRes.data.data.challenge as string;
  const signature = bs58.encode(
    nacl.sign.detached(new TextEncoder().encode(challenge), signer.secretKey),
  );

  return { challenge, signature };
}

async function cleanup() {
  if (accountId && apiKey) {
    try {
      await axios.delete(`${API_URL}/agent/wallets/${accountId}`, {
        headers: { 'X-API-Key': apiKey },
      });
      console.log('  ✅ Account closed via agent API');
    } catch (error: any) {
      console.warn('  ⚠️ Account cleanup via API skipped:', error.response?.data || error.message);
    }
  }

  if (workflowId) {
    await adminSupabase.from('workflows').delete().eq('id', workflowId);
  }
  if (accountId) {
    await adminSupabase.from('accounts').delete().eq('id', accountId);
  }
  if (walletAddress) {
    await adminSupabase.from('telegram_mappings').delete().eq('wallet_address', walletAddress);
    await adminSupabase.from('users').delete().eq('wallet_address', walletAddress);
  }
}

async function runTests() {
  console.log('🚀 Starting Current Backend Integration Test...\n');

  try {
    testKeyPair = Keypair.generate();
    walletAddress = testKeyPair.publicKey.toBase58();
    console.log(`👤 Test Wallet: ${walletAddress}`);

    console.log('\n🔐 [Module 1] Authentication Tests');
    const authSignature = await createSignedChallenge(walletAddress, testKeyPair);
    const loginRes = await axios.post(`${API_URL}/auth/login`, {
      walletAddress,
      signature: authSignature.signature,
    });

    if (!loginRes.data?.data?.authenticated) {
      throw new Error('Signature verification did not return authenticated=true');
    }
    console.log('  ✅ Signature verification succeeded');

    try {
      await axios.post(`${API_URL}/auth/login`, {
        walletAddress,
        signature: authSignature.signature,
      });
      throw new Error('Replay challenge verification should have failed');
    } catch (error: any) {
      if (error.response?.status !== 401) {
        throw error;
      }
      console.log('  ✅ Replay challenge blocked');
    }

    console.log('\n🤖 [Module 2] Agent API Tests');
    const agentSignature = await createSignedChallenge(walletAddress, testKeyPair);
    const registerRes = await axios.post(`${API_URL}/agent/register`, {
      walletAddress,
      signature: agentSignature.signature,
    });
    apiKey = registerRes.data.data.apiKey;

    if (!apiKey) {
      throw new Error('Agent API key was not returned');
    }
    console.log('  ✅ Agent API key issued');

    const { data: user } = await adminSupabase
      .from('users')
      .select('*')
      .eq('wallet_address', walletAddress)
      .single();
    if (user) {
      console.log('  ✅ User record confirmed exists');
    } else {
      throw new Error('User record missing in DB');
    }

    console.log('\n⚙️ [Module 3] Workflow Creation Tests');
    const workflowDefinition = {
      nodes: [],
      connections: {},
    };
    const createWorkflowRes = await axios.post(
      `${API_URL}/agent/workflows`,
      {
        name: 'System Test Workflow',
        description: 'Current-contract integration test',
        definition: workflowDefinition,
        isPublic: true,
        telegramChatId: '123456789',
      },
      {
        headers: { 'X-API-Key': apiKey },
      },
    );
    workflowId = createWorkflowRes.data.data.id;

    if (!workflowId) {
      throw new Error('Workflow was not created');
    }
    console.log('  ✅ Workflow created via agent API');

    const { data: workflowRow, error: workflowError } = await adminSupabase
      .from('workflows')
      .select('id, is_public')
      .eq('id', workflowId)
      .single();
    if (workflowError || !workflowRow) {
      throw workflowError || new Error('Workflow row missing');
    }
    if (!workflowRow.is_public) {
      throw new Error('Workflow is_public was not persisted');
    }
    console.log('  ✅ Workflow public/private contract persisted');

    const { data: telegramMapping, error: telegramError } = await adminSupabase
      .from('telegram_mappings')
      .select('wallet_address, chat_id, notifications_enabled')
      .eq('wallet_address', walletAddress)
      .single();
    if (telegramError || !telegramMapping) {
      throw telegramError || new Error('Telegram mapping missing');
    }
    if (telegramMapping.chat_id !== '123456789' || !telegramMapping.notifications_enabled) {
      throw new Error('Telegram mapping was not persisted as expected');
    }
    console.log('  ✅ Telegram mapping upserted from workflow payload');

    console.log('\n💳 [Module 4] Account Lifecycle Tests');
    const initWalletRes = await axios.post(
      `${API_URL}/agent/wallets/init`,
      {
        accountName: 'System Test Account',
        workflowId,
      },
      {
        headers: { 'X-API-Key': apiKey },
      },
    );
    accountId = initWalletRes.data.data.id;

    if (!accountId) {
      throw new Error('Account was not created');
    }
    console.log('  ✅ Account created via agent API');

    const activeRes = await axios.get(`${API_URL}/workflows/active`, {
      headers: { 'X-API-Key': apiKey },
    });
    if (!Array.isArray(activeRes.data.data)) {
      throw new Error('Active workflow response is invalid');
    }
    console.log('  ✅ Active workflow instances fetched with API key');

    console.log('\n✨ All Systems Go! Test Suite Passed.');
  } catch (error: any) {
    console.error('\n❌ TEST FAILED:', error.message);
    if (error.response) {
      console.error('Response Status:', error.response.status);
      console.error('Response Data:', error.response.data);
    }
    await cleanup();
    process.exit(1);
    return;
  }

  console.log('\n🧹 [Cleanup] Removing Test Data...');
  await cleanup();
  console.log('  ✅ Cleanup Complete');
}

runTests();
