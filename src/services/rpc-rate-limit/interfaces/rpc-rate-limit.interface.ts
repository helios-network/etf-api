import { ChainId } from 'src/config/web3';

export interface RpcRateLimitConfig {
  maxRequests: number;
  windowMs: number;
}

export interface RpcRetryConfig {
  maxRetries: number;
  baseDelay: number;
  maxDelay: number;
}

export interface RpcHealthConfig {
  maxConsecutiveErrors: number;
  rateLimitCooldownMs: number;
  errorRecoveryDelayMs: number;
}

export interface RpcConfig {
  rateLimits: Record<ChainId, RpcRateLimitConfig>;
  retry: RpcRetryConfig;
  health: RpcHealthConfig;
}

export interface RateLimitCheckResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  reset: number;
  waitTime?: number;
}

export interface RpcHealthState {
  url: string;
  chainId: ChainId;
  consecutiveErrors: number;
  lastUsed: number;
  lastError: number | null;
  rateLimitedUntil: number | null;
  isHealthy: boolean;
}
