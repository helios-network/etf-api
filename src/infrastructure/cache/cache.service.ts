import { Injectable, Inject, Logger, Optional } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { ConfigService } from '@nestjs/config';
import { CacheOptions, CacheFetcher } from './cache.types';
import { CACHE_CONSTANTS } from './cache.constants';

/**
 * Service de cache Redis robuste avec pattern cache-aside
 * 
 * @example
 * // Pattern cache-aside simple
 * const user = await cacheService.wrap(
 *   `user:${id}`,
 *   () => this.userModel.findById(id).exec(),
 *   { ttl: 600, namespace: 'users' }
 * );
 * 
 * // Invalidation après mutation
 * await cacheService.del(`user:${id}`);
 * await cacheService.delPattern('users:page:*');
 */
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

  /**
   * Construit une clé de cache avec préfixe complet
   * Format: {namespace}:{env}:{module}:{key}
   */
  private buildKey(key: string, moduleNamespace?: string): string {
    const parts = [
      this.namespace,
      this.nodeEnv,
      moduleNamespace || CACHE_CONSTANTS.DEFAULT_NAMESPACE,
      key,
    ];
    return parts.join(CACHE_CONSTANTS.KEY_SEPARATOR);
  }

  /**
   * Récupère une valeur depuis le cache
   * 
   * @param key - Clé de cache (sans préfixe, sera ajouté automatiquement)
   * @param options - Options de cache (namespace, etc.)
   * @returns La valeur en cache ou undefined si non trouvée
   */
  async get<T>(key: string, options?: CacheOptions): Promise<T | undefined> {
    if (!this.enabled || !this.cacheManager) {
      return undefined;
    }

    try {
      const fullKey = this.buildKey(key, options?.namespace);
      const value = await this.cacheManager.get<T>(fullKey);
      // cache-manager v6 peut retourner null, on convertit en undefined
      return value ?? undefined;
    } catch (error) {
      this.logger.error(`Error getting cache key "${key}": ${error.message}`, error.stack);
      return undefined; // Fallback silencieux
    }
  }

  /**
   * Stocke une valeur dans le cache
   * 
   * @param key - Clé de cache (sans préfixe)
   * @param value - Valeur à stocker
   * @param options - Options de cache (ttl, namespace)
   */
  async set<T>(key: string, value: T, options?: CacheOptions): Promise<void> {
    if (!this.enabled || !this.cacheManager) {
      return; // No-op si désactivé
    }

    try {
      const fullKey = this.buildKey(key, options?.namespace);
      const ttl = options?.ttl ?? this.defaultTtl;
      // cache-manager attend les TTL en millisecondes
      const ttlMs = ttl * 1000;
      await this.cacheManager.set(fullKey, value, ttlMs);
    } catch (error) {
      this.logger.error(`Error setting cache key "${key}": ${error.message}`, error.stack);
      // Fallback silencieux - on continue sans cache
    }
  }

  /**
   * Supprime une clé du cache
   * 
   * @param key - Clé de cache (sans préfixe)
   * @param options - Options de cache (namespace)
   */
  async del(key: string, options?: CacheOptions): Promise<void> {
    if (!this.enabled || !this.cacheManager) {
      return; // No-op si désactivé
    }

    try {
      const fullKey = this.buildKey(key, options?.namespace);
      await this.cacheManager.del(fullKey);
    } catch (error) {
      this.logger.error(`Error deleting cache key "${key}": ${error.message}`, error.stack);
      // Fallback silencieux
    }
  }

  /**
   * Supprime toutes les clés correspondant à un pattern
   * 
   * @param pattern - Pattern de clé (ex: 'users:page:*')
   * @param options - Options de cache (namespace)
   * 
   * @example
   * // Invalider toutes les listes paginées d'utilisateurs
   * await cacheService.delPattern('users:page:*', { namespace: 'users' });
   */
  async delPattern(pattern: string, options?: CacheOptions): Promise<void> {
    if (!this.enabled || !this.cacheManager) {
      return; // No-op si désactivé
    }

    try {
      const fullPattern = this.buildKey(pattern, options?.namespace);
      
      // cache-manager-redis-yet expose le client Redis via store
      const store = (this.cacheManager as any).store;
      
      // Accéder au client Redis (structure peut varier selon la version)
      let redisClient: any = null;
      if (store?.client) {
        redisClient = store.client;
      } else if (store?.store?.client) {
        redisClient = store.store.client;
      } else if (store?.redis) {
        redisClient = store.redis;
      }
      
      if (redisClient && typeof redisClient.keys === 'function') {
        // Utiliser KEYS pour trouver les clés correspondantes
        // Note: Pour de gros volumes, considérer SCAN (non-bloquant)
        const keys = await redisClient.keys(fullPattern);
        
        if (keys.length > 0) {
          // Supprimer toutes les clés trouvées
          if (keys.length === 1) {
            await this.cacheManager.del(keys[0]);
          } else {
            // Utiliser un pipeline pour les suppressions multiples
            await Promise.all(keys.map((key: string) => this.cacheManager!.del(key)));
          }
          this.logger.debug(`Deleted ${keys.length} keys matching pattern "${pattern}"`);
        }
      } else {
        this.logger.warn('Redis client not available for pattern deletion. Falling back to individual deletions.');
        // Fallback: essayer de supprimer la clé directement (sans pattern)
        await this.cacheManager.del(fullPattern);
      }
    } catch (error) {
      this.logger.error(`Error deleting cache pattern "${pattern}": ${error.message}`, error.stack);
      // Fallback silencieux
    }
  }

  /**
   * Pattern cache-aside : récupère depuis le cache ou exécute le fetcher
   * 
   * Implémente le pattern cache-aside de manière thread-safe :
   * 1. Vérifie le cache
   * 2. Si trouvé, retourne la valeur
   * 3. Sinon, exécute le fetcher
   * 4. Stocke le résultat dans le cache
   * 5. Retourne le résultat
   * 
   * @param key - Clé de cache (sans préfixe)
   * @param fetcher - Fonction qui récupère les données depuis la source (DB, API, etc.)
   * @param options - Options de cache (ttl, namespace)
   * @returns La valeur depuis le cache ou depuis le fetcher
   * 
   * @example
   * const user = await cacheService.wrap(
   *   `user:${id}`,
   *   () => this.userModel.findById(id).exec(),
   *   { ttl: 600, namespace: 'users' }
   * );
   */
  async wrap<T>(key: string, fetcher: CacheFetcher<T>, options?: CacheOptions): Promise<T> {
    // Si le cache est désactivé, exécuter directement le fetcher
    if (!this.enabled || !this.cacheManager) {
      return fetcher();
    }

    try {
      // 1. Essayer de récupérer depuis le cache
      const cached = await this.get<T>(key, options);
      if (cached !== undefined && cached !== null) {
        return cached;
      }

      // 2. Cache miss - exécuter le fetcher
      const value = await fetcher();

      // 3. Stocker dans le cache (même si null/undefined pour éviter les appels répétés)
      if (value !== undefined) {
        await this.set(key, value, options);
      }

      return value;
    } catch (error) {
      // En cas d'erreur, fallback vers le fetcher
      this.logger.error(`Error in cache wrap for key "${key}": ${error.message}`, error.stack);
      return fetcher();
    }
  }

  /**
   * Récupère plusieurs valeurs depuis le cache
   * 
   * @param keys - Tableau de clés de cache
   * @param options - Options de cache (namespace)
   * @returns Objet avec les clés et leurs valeurs (undefined si non trouvées)
   */
  async mget<T>(keys: string[], options?: CacheOptions): Promise<Record<string, T | undefined>> {
    if (!this.enabled || !this.cacheManager) {
      return keys.reduce((acc, key) => ({ ...acc, [key]: undefined }), {});
    }

    try {
      const results: Record<string, T | undefined> = {};
      await Promise.all(
        keys.map(async (key) => {
          results[key] = await this.get<T>(key, options);
        }),
      );
      return results;
    } catch (error) {
      this.logger.error(`Error in mget: ${error.message}`, error.stack);
      return keys.reduce((acc, key) => ({ ...acc, [key]: undefined }), {});
    }
  }

  /**
   * Stocke plusieurs valeurs dans le cache
   * 
   * @param entries - Objet avec clés et valeurs à stocker
   * @param options - Options de cache (ttl, namespace)
   */
  async mset<T>(entries: Record<string, T>, options?: CacheOptions): Promise<void> {
    if (!this.enabled || !this.cacheManager) {
      return; // No-op si désactivé
    }

    try {
      await Promise.all(
        Object.entries(entries).map(([key, value]) => this.set(key, value, options)),
      );
    } catch (error) {
      this.logger.error(`Error in mset: ${error.message}`, error.stack);
      // Fallback silencieux
    }
  }

  /**
   * Vide tout le cache (ATTENTION: supprime toutes les clés)
   * 
   * @warning Cette méthode supprime TOUTES les clés du cache, pas seulement celles de cette application
   */
  async reset(): Promise<void> {
    if (!this.enabled || !this.cacheManager) {
      return; // No-op si désactivé
    }

    try {
      // cache-manager v6 utilise clear() au lieu de reset()
      await (this.cacheManager as any).clear?.();
      this.logger.warn('Cache has been reset');
    } catch (error) {
      this.logger.error(`Error resetting cache: ${error.message}`, error.stack);
    }
  }

  /**
   * Vérifie si le cache est activé
   */
  isEnabled(): boolean {
    return this.enabled;
  }
}
