import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { http, type HttpTransport } from 'viem';
import { ChainId } from '../../config/web3';
import { RpcHealthConfig, RpcHealthState } from './interfaces';
import { RpcRetryConfig } from './interfaces/rpc-rate-limit.interface';

@Injectable()
export class RpcRotationService {
  private readonly logger = new Logger(RpcRotationService.name);
  
  private readonly healthStates: Map<string, RpcHealthState> = new Map();
  private readonly transportPool: Map<string, HttpTransport> = new Map();
  
  private readonly rpcUrls: Record<ChainId, string[]>;
  private readonly healthConfig: RpcHealthConfig;
  private readonly retryConfig: RpcRetryConfig;

  constructor(private readonly configService: ConfigService) {
    const appConfig = this.configService.get<any>('rpcUrls');
    const rpcConfig = this.configService.get<any>('rpc');
    
    this.rpcUrls = appConfig || {
      [ChainId.MAINNET]: ['https://ethereum-rpc.publicnode.com'],
      [ChainId.ARBITRUM]: ['https://arbitrum-one-rpc.publicnode.com'],
    };
    
    this.healthConfig = rpcConfig?.health || {
      maxConsecutiveErrors: 3,
      rateLimitCooldownMs: 60000,
      errorRecoveryDelayMs: 60000,
    };
    
    this.retryConfig = rpcConfig?.retry || {
      maxRetries: 5,
      baseDelay: 1000,
      maxDelay: 300000,
    };

    this.initializeHealthStates();
  }

  private initializeHealthStates(): void {
    for (const [chainId, urls] of Object.entries(this.rpcUrls)) {
      for (const url of urls) {
        const key = this.getHealthKey(Number(chainId) as ChainId, url);
        this.healthStates.set(key, {
          url,
          chainId: Number(chainId) as ChainId,
          consecutiveErrors: 0,
          lastUsed: 0,
          lastError: null,
          rateLimitedUntil: null,
          isHealthy: true,
        });
      }
    }
  }

  private getHealthKey(chainId: ChainId, url: string): string {
    return `${chainId}_${url}`;
  }

  isRpcHealthy(url: string, chainId: ChainId): boolean {
    const key = this.getHealthKey(chainId, url);
    const state = this.healthStates.get(key);
    
    if (!state) {
      return false;
    }

    const now = Date.now();
    
    if (state.rateLimitedUntil && now < state.rateLimitedUntil) {
      return false;
    }

    if (state.consecutiveErrors >= this.healthConfig.maxConsecutiveErrors) {
      if (state.lastError && now - state.lastError < this.healthConfig.errorRecoveryDelayMs) {
        return false;
      }
      state.consecutiveErrors = 0;
      state.lastError = null;
    }

    return true;
  }

  getBestRpc(chainId: ChainId): string | null {
    const urls = this.rpcUrls[chainId];
    if (!urls || urls.length === 0) {
      this.logger.warn(`No RPC URLs configured for chain ${chainId}`);
      return null;
    }

    const healthyRpc = urls
      .map((url) => ({
        url,
        state: this.healthStates.get(this.getHealthKey(chainId, url)),
      }))
      .filter(({ url, state }) => {
        if (!state) {
          return false;
        }
        return this.isRpcHealthy(url, chainId);
      });

    if (healthyRpc.length === 0) {
      this.logger.warn(
        `No healthy RPC found for chain ${chainId}, using all RPCs as fallback`,
      );
      const fallbackRpc = urls
        .map((url) => ({
          url,
          state: this.healthStates.get(this.getHealthKey(chainId, url)),
        }))
        .filter(({ state }) => state !== undefined);

      if (fallbackRpc.length === 0) {
        return urls[0];
      }

      fallbackRpc.sort((a, b) => {
        const aLastUsed = a.state?.lastUsed || 0;
        const bLastUsed = b.state?.lastUsed || 0;
        return aLastUsed - bLastUsed;
      });

      return fallbackRpc[0].url;
    }

    healthyRpc.sort((a, b) => {
      const aLastUsed = a.state?.lastUsed || 0;
      const bLastUsed = b.state?.lastUsed || 0;
      return aLastUsed - bLastUsed;
    });

    return healthyRpc[0].url;
  }

  recordSuccess(url: string, chainId: ChainId): void {
    const key = this.getHealthKey(chainId, url);
    const state = this.healthStates.get(key);
    
    if (!state) {
      this.logger.warn(`No health state found for RPC ${url} on chain ${chainId}`);
      return;
    }

    state.consecutiveErrors = 0;
    state.lastError = null;
    state.lastUsed = Date.now();
    state.isHealthy = true;
  }

  recordError(url: string, chainId: ChainId, error?: Error): void {
    const key = this.getHealthKey(chainId, url);
    const state = this.healthStates.get(key);
    
    if (!state) {
      this.logger.warn(`No health state found for RPC ${url} on chain ${chainId}`);
      return;
    }

    state.consecutiveErrors++;
    state.lastError = Date.now();
    state.isHealthy = state.consecutiveErrors < this.healthConfig.maxConsecutiveErrors;

    if (!state.isHealthy) {
      this.logger.warn(
        `RPC ${url} on chain ${chainId} marked as unhealthy after ${state.consecutiveErrors} consecutive errors`,
      );
    }
  }

  recordRateLimit(url: string, chainId: ChainId): void {
    const key = this.getHealthKey(chainId, url);
    const state = this.healthStates.get(key);
    
    if (!state) {
      this.logger.warn(`No health state found for RPC ${url} on chain ${chainId}`);
      return;
    }

    const now = Date.now();
    state.rateLimitedUntil = now + this.healthConfig.rateLimitCooldownMs;
    state.lastUsed = now;
    
    this.logger.debug(
      `RPC ${url} on chain ${chainId} rate-limited until ${new Date(state.rateLimitedUntil).toISOString()}`,
    );
  }

  getTransport(url: string, chainId: ChainId): HttpTransport {
    const key = this.getHealthKey(chainId, url);
    let transport = this.transportPool.get(key);

    if (!transport) {
      transport = http(url, {
        retryCount: this.retryConfig.maxRetries,
        retryDelay: Math.max(100, Math.floor(this.retryConfig.baseDelay / 2)),
      });
      this.transportPool.set(key, transport);
    }

    return transport;
  }

  getRpcUrls(chainId: ChainId): string[] {
    return this.rpcUrls[chainId] || [];
  }

  getHealthState(url: string, chainId: ChainId): RpcHealthState | undefined {
    const key = this.getHealthKey(chainId, url);
    return this.healthStates.get(key);
  }
}
