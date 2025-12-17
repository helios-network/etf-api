import * as os from 'os';
import { ChainId, DEFAULT_RPC_URLS } from './web3';

export interface DatabaseConfig {
  mongodb: {
    uri: string;
  };
  redis: {
    host: string;
    port: number;
    password?: string;
    ttl: number;
  };
}

export interface CacheConfig {
  enabled: boolean;
  namespace: string;
  ttl: number;
}

export interface CorsConfig {
  enabled: boolean;
  origins: string[] | string;
}

export interface RateLimitConfig {
  enabled: boolean;
  windowMs: number;
  maxRequests: number;
  namespace: string;
}

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
  rateLimits: {
    1: RpcRateLimitConfig; // MAINNET
    42161: RpcRateLimitConfig; // ARBITRUM
  };
  retry: RpcRetryConfig;
  health: RpcHealthConfig;
}

export interface AppConfig {
  nodeEnv: string;
  port: number;
  appRole: 'master' | 'worker';
  workerCount: number;
  database: DatabaseConfig;
  cache: CacheConfig;
  cors: CorsConfig;
  rateLimit: RateLimitConfig;
  rpc: RpcConfig;
  privateKey?: string;
  rpcUrls: {
    [ChainId.MAINNET]: string[];
    [ChainId.ARBITRUM]: string[];
  };
  debugTvl: boolean;
}

function parseRateLimitConfig(config: string): RpcRateLimitConfig {
  const parts = config.split('/');
  if (parts.length !== 2) {
    throw new Error(
      `Invalid rate limit config format: ${config}. Expected format: "maxRequests/windowSeconds"`,
    );
  }
  const maxRequests = parseInt(parts[0], 10);
  const windowSeconds = parseInt(parts[1], 10);
  if (isNaN(maxRequests) || isNaN(windowSeconds) || maxRequests <= 0 || windowSeconds <= 0) {
    throw new Error(
      `Invalid rate limit config values: ${config}. Both values must be positive numbers`,
    );
  }
  return {
    maxRequests,
    windowMs: windowSeconds * 1000,
  };
}

function parseRpcUrls(envVar: string | undefined, defaultUrl: string): string[] {
  if (!envVar || envVar.trim() === '') {
    return [defaultUrl];
  }
  return envVar
    .split(',')
    .map((url) => url.trim())
    .filter((url) => url.length > 0);
}

export default (): AppConfig => {
  const defaultWorkerCount = Math.max(1, os.cpus().length - 1);
  
  return {
    nodeEnv: 'development',
    port: parseInt(process.env.PORT || '3000', 10),
    appRole: (process.env.APP_ROLE as 'master' | 'worker') || 'worker',
    workerCount: parseInt(process.env.WORKER_COUNT || String(defaultWorkerCount), 10),
  database: {
    mongodb: {
      uri: process.env.MONGODB_URI || '',
    },
    redis: {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379', 10),
      password:
        process.env.REDIS_PASSWORD && process.env.REDIS_PASSWORD.trim() !== ''
          ? process.env.REDIS_PASSWORD
          : undefined,
      ttl: parseInt(process.env.REDIS_TTL || '3600', 10),
    },
  },
  cache: {
    enabled:
      process.env.CACHE_ENABLED === 'true' ||
      process.env.CACHE_ENABLED === '1' ||
      process.env.CACHE_ENABLED === undefined,
    namespace: process.env.CACHE_NAMESPACE || 'etf_api',
    ttl: parseInt(process.env.CACHE_TTL || '300', 10),
  },
  cors: {
    enabled: process.env.CORS_ENABLED !== 'false',
    origins:
      process.env.CORS_ORIGINS && process.env.CORS_ORIGINS.trim() !== ''
        ? process.env.CORS_ORIGINS.split(',').map((origin) => origin.trim())
        : '*',
  },
  rateLimit: {
    enabled:
      process.env.RATE_LIMIT_ENABLED === 'true' ||
      process.env.RATE_LIMIT_ENABLED === '1' ||
      process.env.RATE_LIMIT_ENABLED === undefined,
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10),
    maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100', 10),
    namespace: process.env.RATE_LIMIT_NAMESPACE || 'ratelimit',
  },
  rpc: {
    rateLimits: {
      1: parseRateLimitConfig(
        process.env.RPC_RATE_LIMIT_MAINNET || '300/60',
      ),
      42161: parseRateLimitConfig(
        process.env.RPC_RATE_LIMIT_ARBITRUM || '300/60',
      ),
    },
    retry: {
      maxRetries: parseInt(process.env.RPC_RETRY_MAX_RETRIES || '5', 10),
      baseDelay: parseInt(process.env.RPC_RETRY_BASE_DELAY || '1000', 10),
      maxDelay: parseInt(process.env.RPC_RETRY_MAX_DELAY || '300000', 10),
    },
    health: {
      maxConsecutiveErrors: parseInt(
        process.env.RPC_HEALTH_MAX_CONSECUTIVE_ERRORS || '3',
        10,
      ),
      rateLimitCooldownMs: parseInt(
        process.env.RPC_HEALTH_RATE_LIMIT_COOLDOWN_MS || '60000',
        10,
      ),
      errorRecoveryDelayMs: parseInt(
        process.env.RPC_HEALTH_ERROR_RECOVERY_DELAY_MS || '60000',
        10,
      ),
    },
  },
  rpcUrls: {
    [ChainId.MAINNET]: parseRpcUrls(
      process.env.RPC_MAINNET_URLS,
      DEFAULT_RPC_URLS[ChainId.MAINNET],
    ),
    [ChainId.ARBITRUM]: parseRpcUrls(
      process.env.RPC_ARBITRUM_URLS,
      DEFAULT_RPC_URLS[ChainId.ARBITRUM],
    ),
  },
  privateKey: process.env.PRIVATE_KEY,
  debugTvl:
    process.env.DEBUG_TVL === 'true' ||
    process.env.DEBUG_TVL === '1' ||
    false,
  };
};
