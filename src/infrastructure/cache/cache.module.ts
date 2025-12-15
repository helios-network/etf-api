import { Module, Global } from '@nestjs/common';
import { CacheModule as NestCacheModule } from '@nestjs/cache-manager';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Keyv } from 'keyv';
import KeyvRedis from '@keyv/redis';
import { CacheService } from './cache.service';

/**
 * Module de cache Redis global
 * 
 * Ce module est marqué @Global() pour être disponible dans toute l'application
 * sans avoir à l'importer dans chaque module.
 * 
 * Le cache peut être désactivé via CACHE_ENABLED=false pour les tests ou le développement.
 */
@Global()
@Module({
  imports: [
    // Enregistrer le CacheModule de NestJS de manière conditionnelle
    NestCacheModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => {
        const cacheEnabled = configService.get<boolean>('cache.enabled', true);

        // Si le cache est désactivé, retourner une configuration no-op
        if (!cacheEnabled) {
          return {
            store: 'memory', // Store mémoire minimal (ne sera pas utilisé car cache désactivé)
            ttl: 0,
          };
        }

        // Configuration Redis avec Keyv (compatible cache-manager v6)
        const redisHost = configService.get<string>('database.redis.host', 'localhost');
        const redisPort = configService.get<number>('database.redis.port', 6379);
        const redisPassword = configService.get<string>('database.redis.password');

        // Construire l'URL Redis
        let redisUrl = `redis://${redisHost}:${redisPort}`;
        if (redisPassword) {
          redisUrl = `redis://:${redisPassword}@${redisHost}:${redisPort}`;
        }

        const keyvRedis = new KeyvRedis(redisUrl);
        const keyv = new Keyv({
          store: keyvRedis,
        });

        return {
          store: keyv,
          ttl: configService.get<number>('cache.ttl', 300) * 1000, // Convert to milliseconds
        };
      },
      inject: [ConfigService],
    }),
  ],
  providers: [CacheService],
  exports: [CacheService],
})
export class CacheModule {}
