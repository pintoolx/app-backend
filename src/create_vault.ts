import 'dotenv/config';
import { getConnectionPool } from './utils/connection';
import { getKeypair } from './utils/keypair';
import { KaminoVaultConfig, WRAPPED_SOL_MINT } from '@kamino-finance/klend-sdk';
import { createSolanaRpc, address, generateKeyPairSigner } from '@solana/kit'; 
import { EXAMPLE_USDC_VAULT } from './utils/constants';
import Decimal from 'decimal.js/decimal';
import { getMedianSlotDurationInMsFromLastEpochs, KaminoManager, sleep } from '@kamino-finance/klend-sdk';
import { TOKEN_PROGRAM_ADDRESS } from '@solana-program/token';
import { sendAndConfirmTx } from './utils/tx';


async function createWSOLVault() {  
  // 1. 連接到 devnet  
  const rpc = getConnectionPool();  
        
  // 2. 載入您的管理員密鑰對  
  const admin = await getKeypair(); // 或從檔案載入  
    
  console.log("開始3.")
  // 3. 初始化 KaminoManager (使用 staging 程式)  
  const kaminoManager = new KaminoManager(  
    rpc.rpc as any,  
    30000, // DEFAULT_RECENT_SLOT_DURATION_MS  
    address('SLendK7ySfcEzyaFqy93gDnD3RtrpXJcnRwb6zFHJSh'), // 加入這行  
    address('KvauGMspG5k6rtzrqqn7WNn3oZdyKqLKwK2XWQ8FLjd')  // 加入這行  
  );  
    
  // 4. 配置 vault 參數  
  console.log("開始4.")
  const vaultConfig = new KaminoVaultConfig({  
    admin: admin,  
    tokenMint: address("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"),  
    tokenMintProgramId: TOKEN_PROGRAM_ADDRESS,
    performanceFeeRatePercentage: new Decimal(0.0),  
    managementFeeRatePercentage: new Decimal(0.0),  
    name: 'USDC Vault',  
    vaultTokenSymbol: 'USDC',  
    vaultTokenName: 'TEST'  
  });  

  const kvaultExists = await rpc.rpc.getAccountInfo(  
    address('KvauGMspG5k6rtzrqqn7WNn3oZdyKqLKwK2XWQ8FLjd')  
  ).send();  
  console.log('Kvault program:', kvaultExists);

  const klendExists = await rpc.rpc.getAccountInfo(  
    address('SLendK7ySfcEzyaFqy93gDnD3RtrpXJcnRwb6zFHJSh')  
  ).send();  
  console.log('Klend program:', klendExists);
    
  console.log("開始5.")
  // 5. 創建 vault 指令  
  const { vault, lut, initVaultIxs } = await kaminoManager.createVaultIxs(vaultConfig);  
    
  console.log("開始6.")
  // 6. 執行交易 1: 初始化 vault 和 LUT  
  await sendAndConfirmTx(rpc, admin, [  
    ...initVaultIxs.createAtaIfNeededIxs,  
    ...initVaultIxs.initVaultIxs,  
    initVaultIxs.createLUTIx  
  ],
    [],
    [],
    'InitVault'
  );  
    
  // 7. 等待 LUT 啟動  
  await sleep(100000);  
    
  console.log("開始8.")
  // 8. 執行交易 2: 填充 LUT  
  await sendAndConfirmTx(rpc, admin, [  
    ...initVaultIxs.populateLUTIxs,  
    ...initVaultIxs.cleanupIxs  
  ]);  

  await sleep(20000);  
    
  console.log("開始9.")
  // 9. 執行交易 3: 設置 metadata  
  await sendAndConfirmTx(rpc, admin, [  
    initVaultIxs.initSharesMetadataIx  
  ]);  
    
  console.log('Vault 創建成功:', vault.address);  
  console.log('LUT 地址:', lut);  
    
  return vault.address;  
}

const res = await createWSOLVault();
console.log(res);
