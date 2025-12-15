import { Injectable, Inject, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);

  constructor(@Inject('REDIS_CLIENT') private readonly redisClient: Redis) {}

  async get<T>(key: string): Promise<T | null> {
    const value = await this.redisClient.get(key);
    return value ? (JSON.parse(value) as T) : null;
  }

  async set(key: string, value: any, ttl?: number): Promise<void> {
    const stringValue = JSON.stringify(value);
    if (ttl) {
      await this.redisClient.setex(key, ttl, stringValue);
    } else {
      await this.redisClient.set(key, stringValue);
    }
  }

  async del(key: string): Promise<void> {
    await this.redisClient.del(key);
  }

  async exists(key: string): Promise<boolean> {
    const result = await this.redisClient.exists(key);
    return result === 1;
  }

  async reset(): Promise<void> {
    await this.redisClient.flushdb();
  }

  getClient(): Redis {
    return this.redisClient;
  }

  async onModuleInit() {
    // Verify Redis connection on startup
    try {
      const result = await this.redisClient.ping();
      if (result === 'PONG') {
        this.logger.log('Redis connection verified successfully');
      } else {
        this.logger.warn('Redis ping returned unexpected result:', result);
      }
    } catch (error) {
      this.logger.warn(
        `Redis connection verification failed: ${error instanceof Error ? error.message : 'Unknown error'}. ` +
          'Application will continue with fail-open behavior for rate limiting.',
      );
    }
  }

  async onModuleDestroy() {
    await this.redisClient.quit();
  }
}

