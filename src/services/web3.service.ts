import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createPublicClient,
  createWalletClient,
  type PublicClient,
  type WalletClient,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { mainnet, arbitrum } from 'viem/chains';
import { ChainId } from '../config/web3';
import { RpcRotationService } from './rpc-rate-limit/rpc-rotation.service';
import { createRotatingTransport, createTransportWithSpecificRpc } from './rpc-rate-limit/transport-wrapper';

@Injectable()
export class Web3Service {
  private readonly logger = new Logger(Web3Service.name);
  private readonly publicClients: Record<ChainId, PublicClient>;
  private readonly walletClients: Record<ChainId, WalletClient>;
  private readonly privateKey: `0x${string}` | undefined;

  constructor(
    private readonly configService: ConfigService,
    private readonly rpcRotationService: RpcRotationService,
  ) {
    const rpcConfig = this.configService.get<any>('rpc');
    const retryConfig = rpcConfig?.retry || {
      maxRetries: 5,
      baseDelay: 1000,
      maxDelay: 300000,
    };

    this.publicClients = {
      [ChainId.MAINNET]: createPublicClient({
        chain: mainnet,
        transport: createRotatingTransport(
          ChainId.MAINNET,
          this.rpcRotationService,
          retryConfig,
        ),
      }),
      [ChainId.ARBITRUM]: createPublicClient({
        chain: arbitrum,
        transport: createRotatingTransport(
          ChainId.ARBITRUM,
          this.rpcRotationService,
          retryConfig,
        ),
      }),
    };

    this.walletClients = {
      [ChainId.MAINNET]: createWalletClient({
        chain: mainnet,
        transport: createRotatingTransport(
          ChainId.MAINNET,
          this.rpcRotationService,
          retryConfig,
        ),
      }),
      [ChainId.ARBITRUM]: createWalletClient({
        chain: arbitrum,
        transport: createRotatingTransport(
          ChainId.ARBITRUM,
          this.rpcRotationService,
          retryConfig,
        ),
      }),
    };

    const privateKey = this.configService.get<string>('PRIVATE_KEY');
    const nodeEnv = this.configService.get<string>('nodeEnv', 'development');
    
    if (privateKey) {
      this.privateKey = privateKey as `0x${string}`;
    } else {
      this.logger.warn(
        'PRIVATE_KEY is not configured. Reward claim endpoint will fail.',
      );
    }
  }

  getPublicClient(chainId: ChainId): PublicClient {
    return this.publicClients[chainId];
  }

  getWalletClient(chainId: ChainId): WalletClient {
    return this.walletClients[chainId];
  }

  getAccount(chainId: ChainId) {
    if (!this.privateKey) {
      throw new Error('PRIVATE_KEY not configured');
    }
    return privateKeyToAccount(this.privateKey);
  }

  /**
   * Crée un PublicClient avec un RPC spécifique
   * Utilisé lors de la rotation de RPC quand un rate limit global est détecté
   */
  createPublicClientWithRpc(chainId: ChainId, rpcUrl: string): PublicClient {
    const rpcConfig = this.configService.get<any>('rpc');
    const retryConfig = rpcConfig?.retry || {
      maxRetries: 5,
      baseDelay: 1000,
      maxDelay: 300000,
    };

    const chain = chainId === ChainId.MAINNET ? mainnet : arbitrum;
    return createPublicClient({
      chain,
      transport: createTransportWithSpecificRpc(rpcUrl, retryConfig),
    });
  }

  /**
   * Crée un WalletClient avec un RPC spécifique
   * Utilisé lors de la rotation de RPC quand un rate limit global est détecté
   */
  createWalletClientWithRpc(chainId: ChainId, rpcUrl: string): WalletClient {
    const rpcConfig = this.configService.get<any>('rpc');
    const retryConfig = rpcConfig?.retry || {
      maxRetries: 5,
      baseDelay: 1000,
      maxDelay: 300000,
    };

    const chain = chainId === ChainId.MAINNET ? mainnet : arbitrum;
    return createWalletClient({
      chain,
      transport: createTransportWithSpecificRpc(rpcUrl, retryConfig),
    });
  }
}
