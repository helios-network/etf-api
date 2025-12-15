import { Injectable, Inject, Logger, Optional } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { ConfigService } from '@nestjs/config';
import { CacheOptions, CacheFetcher } from './cache.types';
import { CACHE_CONSTANTS } from './cache.constants';

interface RedisClientWithScan {
  scan(
    cursor: string | number,
    ...args: string[]
  ): Promise<[string, string[]]>;
  mget(...keys: string[]): Promise<(string | null)[]>;
}

interface KeyvStoreWithClient {
  client?: RedisClientWithScan;
  store?: {
    client?: RedisClientWithScan;
  };
  redis?: RedisClientWithScan;
}

@Injectable()
export class CacheService {
  private readonly logger = new Logger(CacheService.name);
  private readonly enabled: boolean;
  private readonly namespace: string;
  private readonly defaultTtl: number;
  private readonly nodeEnv: string;

  constructor(
    @Optional() @Inject(CACHE_MANAGER) private readonly cacheManager: Cache | null,
    private readonly configService: ConfigService,
  ) {
    this.enabled = this.configService.get<boolean>('cache.enabled', true);
    this.namespace = this.configService.get<string>('cache.namespace', 'etf_api');
    this.defaultTtl = this.configService.get<number>('cache.ttl', 300);
    this.nodeEnv = this.configService.get<string>('nodeEnv', 'development');

    if (!this.enabled) {
      this.logger.warn('Cache is disabled. All cache operations will be no-ops.');
    }
  }

  private buildKey(key: string, moduleNamespace?: string): string {
    const parts = [
      this.namespace,
      this.nodeEnv,
      moduleNamespace || CACHE_CONSTANTS.DEFAULT_NAMESPACE,
      key,
    ];
    return parts.join(CACHE_CONSTANTS.KEY_SEPARATOR);
  }

  async get<T>(key: string, options?: CacheOptions): Promise<T | undefined> {
    if (!this.enabled || !this.cacheManager) {
      return undefined;
    }

    try {
      const fullKey = this.buildKey(key, options?.namespace);
      const value = await this.cacheManager.get<T>(fullKey);
      return value ?? undefined;
    } catch (error) {
      this.logger.error(`Error getting cache key "${key}": ${error.message}`, error.stack);
      return undefined;
    }
  }

  async set<T>(key: string, value: T, options?: CacheOptions): Promise<void> {
    if (!this.enabled || !this.cacheManager) {
      return;
    }

    try {
      const fullKey = this.buildKey(key, options?.namespace);
      const ttl = options?.ttl ?? this.defaultTtl;
      const ttlMs = ttl * 1000;
      await this.cacheManager.set(fullKey, value, ttlMs);
    } catch (error) {
      this.logger.error(`Error setting cache key "${key}": ${error.message}`, error.stack);
    }
  }

  async del(key: string, options?: CacheOptions): Promise<void> {
    if (!this.enabled || !this.cacheManager) {
      return;
    }

    try {
      const fullKey = this.buildKey(key, options?.namespace);
      await this.cacheManager.del(fullKey);
    } catch (error) {
      this.logger.error(`Error deleting cache key "${key}": ${error.message}`, error.stack);
      // Fallback silencieux
    }
  }

  async delPattern(pattern: string, options?: CacheOptions): Promise<void> {
    if (!this.enabled || !this.cacheManager) {
      return; // No-op si désactivé
    }

    try {
      const fullPattern = this.buildKey(pattern, options?.namespace);
      
      const store = (this.cacheManager as any)?.store as KeyvStoreWithClient | undefined;
      
      if (!store) {
        this.logger.warn('Store not available for pattern deletion. Falling back to individual deletions.');
        await this.cacheManager.del(fullPattern);
        return;
      }

      const redisClient: RedisClientWithScan | undefined =
        store.client || store.store?.client || store.redis || undefined;
      
      if (redisClient && typeof redisClient.scan === 'function') {
        const keys: string[] = [];
        let cursor = '0';
        
        do {
          const result = await redisClient.scan(
            cursor,
            'MATCH',
            fullPattern,
            'COUNT',
            '100',
          );
          cursor = result[0];
          if (Array.isArray(result[1])) {
            keys.push(...result[1]);
          }
        } while (cursor !== '0');
        
        if (keys.length > 0) {
          if (keys.length === 1) {
            await this.cacheManager.del(keys[0]);
          } else {
            await Promise.all(keys.map((key: string) => this.cacheManager!.del(key)));
          }
          this.logger.debug(`Deleted ${keys.length} keys matching pattern "${pattern}"`);
        }
      } else {
        this.logger.warn('Redis client not available for pattern deletion. Falling back to individual deletions.');
        await this.cacheManager.del(fullPattern);
      }
    } catch (error) {
      this.logger.error(`Error deleting cache pattern "${pattern}": ${error.message}`, error.stack);
    }
  }

  async wrap<T>(key: string, fetcher: CacheFetcher<T>, options?: CacheOptions): Promise<T> {
    if (!this.enabled || !this.cacheManager) {
      return fetcher();
    }

    try {
      const cached = await this.get<T>(key, options);
      if (cached !== undefined && cached !== null) {
        return cached;
      }
      const value = await fetcher();

      if (value !== undefined) {
        await this.set(key, value, options);
      }

      return value;
    } catch (error) {
      this.logger.error(`Error in cache wrap for key "${key}": ${error.message}`, error.stack);
      return fetcher();
    }
  }

  async mget<T>(keys: string[], options?: CacheOptions): Promise<Record<string, T | undefined>> {
    if (!this.enabled || !this.cacheManager) {
      return keys.reduce((acc, key) => ({ ...acc, [key]: undefined }), {});
    }

    if (keys.length === 0) {
      return {};
    }

    try {
      const fullKeys = keys.map((key) => this.buildKey(key, options?.namespace));

      const store = (this.cacheManager as any)?.store as KeyvStoreWithClient | undefined;
      const redisClient: RedisClientWithScan | undefined =
        store?.client || store?.store?.client || store?.redis || undefined;

      if (redisClient && typeof redisClient.mget === 'function') {
        const values = await redisClient.mget(...fullKeys);
        const results: Record<string, T | undefined> = {};

        keys.forEach((key, index) => {
          const value = values[index];
          if (value !== null && value !== undefined) {
            try {
              results[key] = JSON.parse(value as string) as T;
            } catch (parseError) {
              results[key] = value as T;
            }
          } else {
            results[key] = undefined;
          }
        });

        return results;
      } else {
        this.logger.debug('MGET not available, falling back to individual GET calls');
        const results: Record<string, T | undefined> = {};
        await Promise.all(
          keys.map(async (key) => {
            results[key] = await this.get<T>(key, options);
          }),
        );
        return results;
      }
    } catch (error) {
      this.logger.error(`Error in mget: ${error.message}`, error.stack);
      const results: Record<string, T | undefined> = {};
      await Promise.all(
        keys.map(async (key) => {
          try {
            results[key] = await this.get<T>(key, options);
          } catch {
            results[key] = undefined;
          }
        }),
      );
      return results;
    }
  }

  async mset<T>(entries: Record<string, T>, options?: CacheOptions): Promise<void> {
    if (!this.enabled || !this.cacheManager) {
      return;
    }

    try {
      await Promise.all(
        Object.entries(entries).map(([key, value]) => this.set(key, value, options)),
      );
    } catch (error) {
      this.logger.error(`Error in mset: ${error.message}`, error.stack);
    }
  }

  async reset(): Promise<void> {
    if (!this.enabled || !this.cacheManager) {
      return;
    }

    try {
      const appPattern = `${this.namespace}:${this.nodeEnv}:*`;
      await this.delPattern(appPattern);
      this.logger.warn(`Cache reset for namespace: ${this.namespace}:${this.nodeEnv}`);
    } catch (error) {
      this.logger.error(`Error resetting cache: ${error.message}`, error.stack);
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }
}
