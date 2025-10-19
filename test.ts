import { KaminoClient } from './client.ts';
import Decimal from 'decimal.js'; 

const client = await KaminoClient.initialize({  
  keypairPath: 'wallet-keypair.json',  
  isMainnet: false  
});

const allVaults = await client.getAllVaults();
console.log('All vaults:', allVaults);
