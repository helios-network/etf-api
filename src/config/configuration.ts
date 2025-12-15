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

export interface AppConfig {
  nodeEnv: string;
  port: number;
  appRole: 'master' | 'worker';
  workerCount: number;
  database: DatabaseConfig;
  cache: CacheConfig;
  cors: CorsConfig;
  rateLimit: RateLimitConfig;
  privateKey?: string;
  debugTvl: boolean;
}

import * as os from 'os';

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
  privateKey: process.env.PRIVATE_KEY,
  debugTvl:
    process.env.DEBUG_TVL === 'true' ||
    process.env.DEBUG_TVL === '1' ||
    false,
  };
};
