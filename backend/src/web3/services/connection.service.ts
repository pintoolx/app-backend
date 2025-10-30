import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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

@Injectable()
export class ConnectionService {
  private connectionPool: ConnectionPool;

  constructor(private configService: ConfigService) {
    this.initialize();
  }

  private initialize() {
    const rpcUrl = this.configService.get<string>('solana.rpcUrl');
    const wsUrl = this.configService.get<string>('solana.wsUrl');

    if (!rpcUrl) {
      throw new Error('Solana RPC URL is not configured');
    }

    console.log(`✅ Initializing Solana connection: ${rpcUrl}`);

    const rpc = this.initRpc(rpcUrl);
    const ws = createSolanaRpcSubscriptions(wsUrl || this.convertToWsUrl(rpcUrl));
    const legacyConnection = new Connection(rpcUrl, 'processed');

    this.connectionPool = {
      rpc,
      wsRpc: ws,
      legacyConnection,
    };
  }

  getConnectionPool(): ConnectionPool {
    return this.connectionPool;
  }

  private initRpc(rpcUrl: string): Rpc<SolanaRpcApi> {
    const api = createSolanaRpcApi<SolanaRpcApi>({
      ...DEFAULT_RPC_CONFIG,
      defaultCommitment: 'processed',
    });
    return createRpc({ api, transport: createDefaultRpcTransport({ url: rpcUrl }) });
  }

  private convertToWsUrl(httpUrl: string): string {
    const url = new URL(httpUrl);
    if (url.protocol === 'https:') {
      url.protocol = 'wss:';
    } else if (url.protocol === 'http:') {
      url.protocol = 'ws:';
    }
    return url.href;
  }
}
