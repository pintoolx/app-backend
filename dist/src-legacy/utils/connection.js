import { createDefaultRpcTransport, createRpc, createSolanaRpcApi, createSolanaRpcSubscriptions, DEFAULT_RPC_CONFIG, } from '@solana/kit';
import { getEnvOrThrow } from './env';
import { Connection } from '@solana/web3.js';
export function getConnectionPool() {
    const RPC_ENDPOINT = getEnvOrThrow('RPC');
    console.log('RPC_ENDPOINT:', RPC_ENDPOINT);
    const rpcUrl = new URL(RPC_ENDPOINT);
    const wsUrl = new URL(RPC_ENDPOINT);
    if (wsUrl.protocol === 'https:') {
        wsUrl.protocol = 'wss:';
    }
    else if (wsUrl.protocol === 'http:') {
        wsUrl.protocol = 'ws:';
    }
    const rpc = initRpc(rpcUrl.href);
    const ws = createSolanaRpcSubscriptions(wsUrl.href);
    const legacyConnection = new Connection(RPC_ENDPOINT, 'processed');
    return {
        rpc,
        wsRpc: ws,
        legacyConnection,
    };
}
export function initRpc(rpcUrl) {
    const api = createSolanaRpcApi({
        ...DEFAULT_RPC_CONFIG,
        defaultCommitment: 'processed',
    });
    return createRpc({ api, transport: createDefaultRpcTransport({ url: rpcUrl }) });
}
//# sourceMappingURL=connection.js.map