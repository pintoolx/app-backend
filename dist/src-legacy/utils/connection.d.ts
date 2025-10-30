import { Rpc, RpcSubscriptions, SolanaRpcApi, SolanaRpcSubscriptionsApi } from '@solana/kit';
import { Connection } from '@solana/web3.js';
export type ConnectionPool = {
    rpc: Rpc<SolanaRpcApi>;
    wsRpc: RpcSubscriptions<SolanaRpcSubscriptionsApi>;
    legacyConnection: Connection;
};
export declare function getConnectionPool(): ConnectionPool;
export declare function initRpc(rpcUrl: string): Rpc<SolanaRpcApi>;
