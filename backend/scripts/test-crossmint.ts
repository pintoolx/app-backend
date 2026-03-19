/**
 * Crossmint 連接測試腳本
 * 執行: npx ts-node scripts/test-crossmint.ts
 */
import 'dotenv/config';
import { createCrossmint, CrossmintWallets } from '@crossmint/wallets-sdk';

const CROSSMINT_API_KEY = process.env.CROSSMINT_SERVER_API_KEY;
const CROSSMINT_SIGNER_SECRET = process.env.CROSSMINT_SIGNER_SECRET;
const CROSSMINT_ENVIRONMENT = process.env.CROSSMINT_ENVIRONMENT || 'staging';

async function testCrossmintConnection() {
  console.log('='.repeat(60));
  console.log('Crossmint Connection Test (SDK)');
  console.log('='.repeat(60));
  console.log(`Environment: ${CROSSMINT_ENVIRONMENT}`);
  console.log(`API Key: ${CROSSMINT_API_KEY?.substring(0, 20)}...`);
  console.log('');

  if (!CROSSMINT_API_KEY) {
    console.error('❌ CROSSMINT_SERVER_API_KEY is not set');
    process.exit(1);
  }

  if (!CROSSMINT_SIGNER_SECRET) {
    console.error('❌ CROSSMINT_SIGNER_SECRET is not set');
    console.log('   Generate one with: echo "CROSSMINT_SIGNER_SECRET=\\"xmsk1_$(openssl rand -hex 32)\\""');
    process.exit(1);
  }

  const crossmint = createCrossmint({ apiKey: CROSSMINT_API_KEY });
  const wallets = CrossmintWallets.from(crossmint);

  try {
    // 測試 1: 創建一個測試錢包
    console.log('📝 Test 1: Creating a test wallet...');

    const testUserId = `test_user_${Date.now()}`;
    const wallet = await wallets.createWallet({
      chain: 'solana',
      signer: { type: 'server', secret: CROSSMINT_SIGNER_SECRET },
      owner: `userId:${testUserId}`,
    });

    console.log(`✅ Wallet created successfully!`);
    console.log(`   Address: ${wallet.address}`);
    console.log('');

    // 測試 2: 獲取剛創建的錢包
    console.log('📝 Test 2: Retrieving the wallet...');

    const retrievedWallet = await wallets.getWallet(wallet.address, {
      chain: 'solana',
      signer: { type: 'server', secret: CROSSMINT_SIGNER_SECRET },
    });

    console.log(`✅ Wallet retrieved successfully!`);
    console.log(`   Address: ${retrievedWallet.address}`);
    console.log('');

    // 總結
    console.log('='.repeat(60));
    console.log('✅ All tests passed! Crossmint SDK is working correctly.');
    console.log('='.repeat(60));
    console.log('');
    console.log('Test wallet details:');
    console.log(`  Address: ${wallet.address}`);
    console.log('');
    console.log('Note: This is a Solana Devnet wallet (staging environment).');
    console.log('You can view it at: https://explorer.solana.com/address/' + wallet.address + '?cluster=devnet');

  } catch (error) {
    console.error('❌ Test failed with error:', error);
    process.exit(1);
  }
}

testCrossmintConnection();
