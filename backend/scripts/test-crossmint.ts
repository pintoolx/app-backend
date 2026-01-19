/**
 * Crossmint 連接測試腳本
 * 執行: npx ts-node scripts/test-crossmint.ts
 */
import 'dotenv/config';

const CROSSMINT_API_KEY = process.env.CROSSMINT_SERVER_API_KEY;
const CROSSMINT_ENVIRONMENT = process.env.CROSSMINT_ENVIRONMENT || 'staging';

const BASE_URL = CROSSMINT_ENVIRONMENT === 'staging'
  ? 'https://staging.crossmint.com/api'
  : 'https://www.crossmint.com/api';

async function testCrossmintConnection() {
  console.log('='.repeat(60));
  console.log('Crossmint Connection Test');
  console.log('='.repeat(60));
  console.log(`Environment: ${CROSSMINT_ENVIRONMENT}`);
  console.log(`API URL: ${BASE_URL}`);
  console.log(`API Key: ${CROSSMINT_API_KEY?.substring(0, 20)}...`);
  console.log('');

  if (!CROSSMINT_API_KEY) {
    console.error('❌ CROSSMINT_SERVER_API_KEY is not set');
    process.exit(1);
  }

  try {
    // 測試 1: 創建一個測試錢包
    console.log('📝 Test 1: Creating a test wallet...');
    
    const testUserId = `test_user_${Date.now()}`;
    const createResponse = await fetch(`${BASE_URL}/2025-06-09/wallets`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-KEY': CROSSMINT_API_KEY,
      },
      body: JSON.stringify({
        chainType: 'solana',
        type: 'smart',
        owner: `userId:${testUserId}`,
      }),
    });

    if (!createResponse.ok) {
      const errorText = await createResponse.text();
      console.error(`❌ Failed to create wallet: ${createResponse.status}`);
      console.error(`   Error: ${errorText}`);
      process.exit(1);
    }

    const wallet = await createResponse.json();
    console.log(`✅ Wallet created successfully!`);
    console.log(`   Address: ${wallet.address}`);
    console.log(`   Type: ${wallet.type}`);
    console.log('');

    // 測試 2: 獲取剛創建的錢包
    console.log('📝 Test 2: Retrieving the wallet...');
    
    const getResponse = await fetch(
      `${BASE_URL}/2025-06-09/wallets/${encodeURIComponent(wallet.address)}`,
      {
        method: 'GET',
        headers: {
          'X-API-KEY': CROSSMINT_API_KEY,
        },
      }
    );

    if (!getResponse.ok) {
      const errorText = await getResponse.text();
      console.error(`❌ Failed to get wallet: ${getResponse.status}`);
      console.error(`   Error: ${errorText}`);
      process.exit(1);
    }

    const retrievedWallet = await getResponse.json();
    console.log(`✅ Wallet retrieved successfully!`);
    console.log(`   Address: ${retrievedWallet.address}`);
    console.log('');

    // 總結
    console.log('='.repeat(60));
    console.log('✅ All tests passed! Crossmint is working correctly.');
    console.log('='.repeat(60));
    console.log('');
    console.log('Test wallet details:');
    console.log(`  Address: ${wallet.address}`);
    console.log(`  Locator: userId:${testUserId}:solana:mpc:0`);
    console.log('');
    console.log('Note: This is a Solana Devnet wallet (staging environment).');
    console.log('You can view it at: https://explorer.solana.com/address/' + wallet.address + '?cluster=devnet');

  } catch (error) {
    console.error('❌ Test failed with error:', error);
    process.exit(1);
  }
}

testCrossmintConnection();
