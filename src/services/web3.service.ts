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
import { ChainId, DEFAULT_RPC_URLS } from '../config/web3';
import { createRateLimitedTransport } from './rpc-rate-limit/transport-wrapper';

@Injectable()
export class Web3Service {
  private readonly logger = new Logger(Web3Service.name);
  private readonly publicClients: Record<ChainId, PublicClient>;
  private readonly walletClients: Record<ChainId, WalletClient>;
  private readonly privateKey: `0x${string}` | undefined;

  constructor(private readonly configService: ConfigService) {
    // Get RPC config for retry settings
    const rpcConfig = this.configService.get<any>('rpc');
    const retryConfig = rpcConfig?.retry || {
      maxRetries: 5,
      baseDelay: 1000,
      maxDelay: 300000,
    };

    // Initialize public clients with rate-limited transport
    this.publicClients = {
      [ChainId.MAINNET]: createPublicClient({
        chain: mainnet,
        transport: createRateLimitedTransport(
          DEFAULT_RPC_URLS[ChainId.MAINNET],
          retryConfig,
        ),
      }),
      [ChainId.ARBITRUM]: createPublicClient({
        chain: arbitrum,
        transport: createRateLimitedTransport(
          DEFAULT_RPC_URLS[ChainId.ARBITRUM],
          retryConfig,
        ),
      }),
    };

    // Initialize wallet clients with rate-limited transport
    this.walletClients = {
      [ChainId.MAINNET]: createWalletClient({
        chain: mainnet,
        transport: createRateLimitedTransport(
          DEFAULT_RPC_URLS[ChainId.MAINNET],
          retryConfig,
        ),
      }),
      [ChainId.ARBITRUM]: createWalletClient({
        chain: arbitrum,
        transport: createRateLimitedTransport(
          DEFAULT_RPC_URLS[ChainId.ARBITRUM],
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
}
