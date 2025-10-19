import { DEFAULT_RECENT_SLOT_DURATION_MS, KaminoManager } from '@kamino-finance/klend-sdk';  
import { type Address, createSolanaRpc } from '@solana/kit';
import { createDefaultRpcTransport, createRpc, createSolanaRpcApi } from '@solana/kit';  
  
// 建立 RPC 連線  
const rpc = createRpc({  
  api: createSolanaRpcApi(),  
  transport: createDefaultRpcTransport({ url: 'https://devnet-rpc.shyft.to?api_key=v9Y9yle7KKGg5TUg' })  
});
   
// 初始化 KaminoManager，使用 staging program IDs (devnet)  
const kaminoManager = new KaminoManager(  
  rpc as any,
  DEFAULT_RECENT_SLOT_DURATION_MS,  
  "SLendK7ySfcEzyaFqy93gDnD3RtrpXJcnRwb6zFHJSh" as Address,   // devnet klend program  
  "KVault7ySfcEzyaFqy93gDnD3RtrpXJcnRwb6zFHJSh" as Address   // devnet kvault program  
);  
  
// 取得所有 vaults  
kaminoManager.getAllVaults().then(allVaults => {
  // 處理 allVaults 數據
  allVaults.forEach(vault => {
    console.log('Vault 地址:', vault.address);
    console.log('Vault 狀態:', vault.state);
  });
  console.log('All vaults fetched successfully.');
}).catch(err => {
  console.error('Failed to fetch vaults:', err);
});
