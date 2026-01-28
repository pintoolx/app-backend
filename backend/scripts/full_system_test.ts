
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
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing Supabase env vars');
  process.exit(1);
}

// 1. Setup Clients
const adminSupabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
const anonSupabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY!);

// Test Data
let testKeyPair: Keypair;
let walletAddress: string;
let accountId: string;
let challengeStr: string;
let signatureStr: string;

async function runTests() {
  console.log('🚀 Starting Comprehensive System Test...\n');

  try {
    testKeyPair = Keypair.generate();
    walletAddress = testKeyPair.publicKey.toBase58();
    console.log(`👤 Test Wallet: ${walletAddress}`);

    // ==========================================
    // MODULE 1: AUTHENTICATION
    // ==========================================
    console.log('\n🔐 [Module 1] Authentication Tests');

    // Test 1.1: Generate Challenge
    console.log('  1.1 Requesting Challenge...');
    const challengeRes = await axios.post(`${API_URL}/auth/challenge`, { walletAddress });
    challengeStr = challengeRes.data.data.challenge;
    if (!challengeStr.includes(walletAddress)) throw new Error('Invalid challenge format');
    console.log('  ✅ Challenge Received');

    // Test 1.2: Sign & Verify (Success Path)
    console.log('  1.2 Verifying Signature (Valid)...');
    const messageBytes = new TextEncoder().encode(challengeStr);
    const signature = nacl.sign.detached(messageBytes, testKeyPair.secretKey);
    signatureStr = bs58.encode(signature);
    
    // We verify via the Crossmint Init endpoint to consume it, or use a dedicated verify endpoint if we had one exposed purely for testing.
    // The "verify-only" endpoint was seemingly removed or is internal.
    // However, we can use the "Init Wallet" flow as proof of auth.
    console.log('  ✅ Signature Generated locally');

    // Test 1.3: Replay Attack (Will test later after consumption)


    // ==========================================
    // MODULE 2: CROSSMINT & DATABASE
    // ==========================================
    console.log('\n💳 [Module 2] Crossmint & Database Tests');

    // Test 2.1: Create Wallet (Authentication & DB Insert)
    console.log('  2.1 Initialize Wallet (should exceed Auth & DB checks)...');
    try {
        const initRes = await axios.post(`${API_URL}/crossmint/wallets/init`, {
            walletAddress,
            signature: signatureStr,
            accountName: 'System Test Account'
        });
        accountId = initRes.data.id;
        console.log('  ✅ Wallet Initialized. Account ID:', accountId);
    } catch (e: any) {
        console.error('  ❌ Init Failed:', e.response?.data || e.message);
        throw e;
    }

    // Test 2.2: Replay Attack (Reuse consume signature)
    console.log('  2.2 Replay Attack Test...');
    try {
        await axios.post(`${API_URL}/crossmint/wallets/init`, {
            walletAddress,
            signature: signatureStr,
            accountName: 'Replay Attempt'
        });
        throw new Error('Replay attack should have failed!');
    } catch (e: any) {
        if (e.response?.status === 401) {
            console.log('  ✅ Replay Attack Blocked (401 Unauthorized)');
        } else {
            console.error('  ❌ Unexpected Replay Response:', e.response?.data || e.message);
            throw e;
        }
    }

    // Test 2.3: Database Foreign Key Integrity (User Creation Verify)
    console.log('  2.3 Verifying User Creation in DB...');
    const { data: user } = await adminSupabase.from('users').select('*').eq('wallet_address', walletAddress).single();
    if (user) {
        console.log('  ✅ User record confirmed exists');
    } else {
        throw new Error('User record missing in DB!');
    }

    // Test 2.4: RLS Penetration Test (Anon Access)
    console.log('  2.4 RLS Security Test (Anon Access to auth_challenges)...');
    const { data: anonData, error: anonError } = await anonSupabase.from('auth_challenges').select('*');
    if (!anonData || anonData.length === 0) {
        console.log('  ✅ RLS Active: Anon cannot read challenges');
    } else {
        console.warn('  ⚠️ WARNING: Anon CAN read challenges! (Check policies)');
    }


    // ==========================================
    // MODULE 3: WORKFLOWS (Basic)
    // ==========================================
    console.log('\njj⚙️ [Module 3] Workflow Tests');
    // Create a dummy workflow directly in DB for testing
    const { data: wf, error: wfError } = await adminSupabase.from('workflows').insert({
        owner_wallet_address: walletAddress,
        name: 'Test Workflow',
        definition: { nodes: [], edges: [] }
    }).select().single();
    
    if (wfError) throw wfError;
    const workflowId = wf.id;

    console.log('  3.1 Trigger Manual Workflow Execution...');
    try {
        // 3.1.1 Get a fresh challenge
        const wfChalRes = await axios.post(`${API_URL}/auth/challenge`, { walletAddress });
        const wfChalStr = wfChalRes.data.data.challenge;
        
        // 3.1.2 Sign it
        const wfMsgBytes = new TextEncoder().encode(wfChalStr);
        const wfSig = bs58.encode(nacl.sign.detached(wfMsgBytes, testKeyPair.secretKey));
        
        // 3.1.3 Execute with signature
        const execRes = await axios.post(`${API_URL}/workflows/${workflowId}/execute`, {
            walletAddress,
            signature: wfSig,
            accountId,
            params: { testMode: true }
        });
        console.log('  ✅ Execution Triggered:', execRes.data);
    } catch (e: any) {
        console.error('  ❌ Workflow Trigger Failed:', e.response?.data || e.message);
        throw e;
    }


    // ==========================================
    // MODULE 4: EDGE CASES (Optimization Sprint)
    // ==========================================
    console.log('\n🧪 [Module 4] Edge Case Tests (New)');

    // Test 4.1: Invalid Signature (401)
    console.log('  4.1 Testing Invalid Signature...');
    try {
        const fakeChalRes = await axios.post(`${API_URL}/auth/challenge`, { walletAddress });
        const fakeMsgBytes = new TextEncoder().encode(fakeChalRes.data.data.challenge);
        const maliciousKeyPair = Keypair.generate(); // Wrong signer
        const fakeSig = bs58.encode(nacl.sign.detached(fakeMsgBytes, maliciousKeyPair.secretKey));
        
        await axios.post(`${API_URL}/crossmint/wallets/init`, {
            walletAddress,
            signature: fakeSig,
            accountName: 'Hacker Account'
        });
        throw new Error('Invalid signature INVALIDLY accepted!');
    } catch (e: any) {
        if (e.response?.status === 401) {
            console.log('  ✅ Invalid Signature Blocked (401)');
        } else {
            console.error('  ❌ Unexpected Status for Invalid Sig:', e.response?.status);
            throw e;
        }
    }

    // Test 4.2: Resource Not Found (404)
    console.log('  4.2 Testing Non-existent Resource (404)...');
    try {
        // Need valid signature to pass Auth guard first
        const nfChalRes = await axios.post(`${API_URL}/auth/challenge`, { walletAddress });
        const nfMsgBytes = new TextEncoder().encode(nfChalRes.data.data.challenge);
        const nfSig = bs58.encode(nacl.sign.detached(nfMsgBytes, testKeyPair.secretKey));
        const randomId = '00000000-0000-0000-0000-000000000000';

        await axios.delete(`${API_URL}/crossmint/wallets/${randomId}`, {
            data: { walletAddress, signature: nfSig }
        });
        throw new Error('Non-existent delete should have failed!');
    } catch (e: any) {
        if (e.response?.status === 404) {
             console.log('  ✅ Non-existent Resource Handle (404)');
        } else {
             console.error('  ❌ Unexpected Status for 404:', e.response?.status, e.response?.data);
             throw e;
        }
    }

    // Test 4.3: Forbidden Access (403) - Deleting someone else's wallet
    console.log('  4.3 Testing Forbidden Access (403)...');
    try {
        // Create attacker wallet
        const attackerKey = Keypair.generate();
        const attackerAddress = attackerKey.publicKey.toBase58();
        
        // Attacker gets challenge & signs correctly as THEMSELVES
        const attChalRes = await axios.post(`${API_URL}/auth/challenge`, { walletAddress: attackerAddress });
        const attMsgBytes = new TextEncoder().encode(attChalRes.data.data.challenge);
        const attSig = bs58.encode(nacl.sign.detached(attMsgBytes, attackerKey.secretKey));

        // Attacker tries to delete VICTIM'S account (accountId from Module 2)
        await axios.delete(`${API_URL}/crossmint/wallets/${accountId}`, {
            data: { walletAddress: attackerAddress, signature: attSig }
        });
        throw new Error('Cross-account delete should have failed!');
    } catch (e: any) {
        if (e.response?.status === 403) {
            console.log('  ✅ Forbidden Access Blocked (403)');
        } else {
            console.error('  ❌ Unexpected Status for 403:', e.response?.status, e.response?.data);
            // Note: If we get 404, it might mean RLS hid the account? 
            // Our Service logic does: select ... eq 'id', accountId. If valid ID, it finds it.
            // Then checks owner. So it should be 403.
            // UNLESS RLS on `accounts` table prevents checking other's accounts?
            // Service uses `supabaseService.client` which is usually specific user or Service Role?
            // Code uses `this.supabaseService.client`. In backend this is usually Service Role (admin).
            // So it sees the account, then checks owner -> 403. Correct.
            throw e;
        }
    }


    // ==========================================
    // CLEANUP
    // ==========================================
    console.log('\n🧹 [Cleanup] Deleting Test Data...');
    
    // We need a NEW challenge to delete properly via API
    console.log('  Generating deletion signature...');
    const delChalRes = await axios.post(`${API_URL}/auth/challenge`, { walletAddress });
    const delMsgBytes = new TextEncoder().encode(delChalRes.data.data.challenge);
    const delSig = bs58.encode(nacl.sign.detached(delMsgBytes, testKeyPair.secretKey));

    await axios.delete(`${API_URL}/crossmint/wallets/${accountId}`, {
        data: { walletAddress, signature: delSig }
    });
    console.log('  ✅ Account Soft Deleted via API');

    // Hard Cleanup for repeatable tests (Optional)
    await adminSupabase.from('workflows').delete().eq('id', workflowId);
    await adminSupabase.from('accounts').delete().eq('id', accountId); // specific cleanup
    await adminSupabase.from('users').delete().eq('wallet_address', walletAddress);
    console.log('  ✅ Hard DB Cleanup Complete');

    console.log('\n✨ All Systems Go! Test Suite Passed.');

  } catch (error: any) {
    console.error('\n❌ TEST FAILED:', error.message);
    if (error.response) {
        console.error('Response Status:', error.response.status);
        console.error('Response Data:', error.response.data);
    }
    process.exit(1);
  }
}

runTests();
