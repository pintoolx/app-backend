import {
  createDefaultRpcTransport,
  createRpc,
  createSolanaRpcApi,
  createSolanaRpcSubscriptions,
  DEFAULT_RPC_CONFIG,
  Rpc,
  RpcSubscriptions,
  SolanaRpcApi,
  SolanaRpcSubscriptionsApi,
} from '@solana/kit';
import { Connection } from '@solana/web3.js';

export type ConnectionPool = {
  rpc: Rpc<SolanaRpcApi>;
  wsRpc: RpcSubscriptions<SolanaRpcSubscriptionsApi>;
  legacyConnection: Connection;
};

let cachedConnectionPool: ConnectionPool | null = null;

export function getConnectionPool(rpcUrl?: string): ConnectionPool {
  // If connection pool already exists, return it
  if (cachedConnectionPool && !rpcUrl) {
    return cachedConnectionPool;
  }

  // Use provided RPC URL or fall back to environment variable
  const RPC_ENDPOINT =
    rpcUrl || process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';

  console.log('✅ Initializing Solana connection:', RPC_ENDPOINT);

  const rpcUrlObj = new URL(RPC_ENDPOINT);
  const wsUrl = new URL(RPC_ENDPOINT);

  if (wsUrl.protocol === 'https:') {
    wsUrl.protocol = 'wss:';
  } else if (wsUrl.protocol === 'http:') {
    wsUrl.protocol = 'ws:';
  }

  const rpc = initRpc(rpcUrlObj.href);
  const ws = createSolanaRpcSubscriptions(wsUrl.href);
  const legacyConnection = new Connection(RPC_ENDPOINT, 'processed');

  const pool = {
    rpc,
    wsRpc: ws,
    legacyConnection,
  };

  // Cache the connection pool
  if (!rpcUrl) {
    cachedConnectionPool = pool;
  }

  return pool;
}

export function initRpc(rpcUrl: string): Rpc<SolanaRpcApi> {
  const api = createSolanaRpcApi<SolanaRpcApi>({
    ...DEFAULT_RPC_CONFIG,
    defaultCommitment: 'processed',
  });
  return createRpc({ api, transport: createDefaultRpcTransport({ url: rpcUrl }) });
}
