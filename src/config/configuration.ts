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

export interface AppConfig {
  nodeEnv: string;
  port: number;
  database: DatabaseConfig;
  cache: CacheConfig;
}

export default (): AppConfig => ({
  nodeEnv: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3000', 10),
  database: {
    mongodb: {
      uri: process.env.MONGODB_URI || '',
    },
    redis: {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379', 10),
      password: process.env.REDIS_PASSWORD || undefined,
      ttl: parseInt(process.env.REDIS_TTL || '3600', 10),
    },
  },
  cache: {
    enabled: process.env.CACHE_ENABLED === 'true' || process.env.CACHE_ENABLED === '1',
    namespace: process.env.CACHE_NAMESPACE || 'etf_api',
    ttl: parseInt(process.env.CACHE_TTL || '300', 10),
  },
});

