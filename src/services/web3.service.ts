import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createPublicClient,
  createWalletClient,
  http,
  type PublicClient,
  type WalletClient,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { mainnet, arbitrum } from 'viem/chains';
import { ChainId, DEFAULT_RPC_URLS } from '../config/web3';

@Injectable()
export class Web3Service {
  private readonly logger = new Logger(Web3Service.name);
  private readonly publicClients: Record<ChainId, PublicClient>;
  private readonly walletClients: Record<ChainId, WalletClient>;
  private readonly privateKey: `0x${string}` | undefined;

  constructor(private readonly configService: ConfigService) {
    const rpcUrls = this.configService.get<{ mainnet?: string; arbitrum?: string }>('rpcUrls');

    const getRpcUrl = (chainId: ChainId): string => {
      if (chainId === ChainId.MAINNET && rpcUrls?.mainnet) {
        return rpcUrls.mainnet;
      }
      if (chainId === ChainId.ARBITRUM && rpcUrls?.arbitrum) {
        return rpcUrls.arbitrum;
      }
      return DEFAULT_RPC_URLS[chainId];
    };

    // Initialize public clients
    const mainnetRpcUrl = getRpcUrl(ChainId.MAINNET);
    const arbitrumRpcUrl = getRpcUrl(ChainId.ARBITRUM);
    this.publicClients = {
      [ChainId.MAINNET]: createPublicClient({
        chain: mainnet,
        transport: http(mainnetRpcUrl),
      }),
      [ChainId.ARBITRUM]: createPublicClient({
        chain: arbitrum,
        transport: http(arbitrumRpcUrl),
      }),
    };

    // Initialize wallet clients
    this.walletClients = {
      [ChainId.MAINNET]: createWalletClient({
        chain: mainnet,
        transport: http(getRpcUrl(ChainId.MAINNET)),
      }),
      [ChainId.ARBITRUM]: createWalletClient({
        chain: arbitrum,
        transport: http(getRpcUrl(ChainId.ARBITRUM)),
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
