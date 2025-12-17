import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../../database/redis/redis.service';
import { ChainId } from '../../config/web3';
import {
  RpcConfig,
  RateLimitCheckResult,
} from './interfaces';

/**
 * Service de rate limiting pour les appels RPC
 * Utilise Redis avec sliding window pour gérer les limites par chaîne
 * 
 * Middleware réutilisable qui peut être utilisé autour de n'importe quel appel RPC
 */
@Injectable()
export class RpcRateLimitService {
  private readonly logger = new Logger(RpcRateLimitService.name);
  private readonly namespace = 'rpc_rate_limit';
  private readonly keySeparator = ':';
  
  // Fallback en mémoire si Redis est down
  private inMemoryCounters: Map<string, { count: number; reset: number }> = new Map();

  constructor(
    private readonly redisService: RedisService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Vérifie le rate limit pour une chaîne donnée
   * Utilise un algorithme de sliding window similaire à RateLimitService
   * 
   * @param chainId La chaîne pour laquelle vérifier le rate limit
   * @returns Résultat avec allowed, limit, remaining, reset, et waitTime si limite atteinte
   */
  async checkRateLimit(chainId: ChainId): Promise<RateLimitCheckResult> {
    const config = this.configService.get<RpcConfig>('rpc');
    if (!config) {
      this.logger.warn('RPC config not found, allowing request');
      return {
        allowed: true,
        limit: 300,
        remaining: 300,
        reset: Date.now() + 60000,
      };
    }

    const rateLimitConfig = config.rateLimits[chainId];
    if (!rateLimitConfig) {
      this.logger.warn(`Rate limit config not found for chain ${chainId}, allowing request`);
      return {
        allowed: true,
        limit: 300,
        remaining: 300,
        reset: Date.now() + 60000,
      };
    }

    try {
      const now = Date.now();
      const windowMs = rateLimitConfig.windowMs;
      const windowStart = Math.floor(now / windowMs) * windowMs;
      const previousWindowStart = windowStart - windowMs;

      const key = `${this.namespace}${this.keySeparator}${chainId}${this.keySeparator}${windowStart}`;
      const prevKey = `${this.namespace}${this.keySeparator}${chainId}${this.keySeparator}${previousWindowStart}`;

      const client = this.redisService.getClient();
      const pipeline = client.pipeline();

      // Incrémenter le compteur de la fenêtre courante
      pipeline.incr(key);
      // Définir le TTL (en secondes) pour la clé
      pipeline.expire(key, Math.ceil(windowMs / 1000));
      // Récupérer le compteur de la fenêtre précédente
      pipeline.get(prevKey);

      const results = await pipeline.exec();

      if (!results) {
        throw new Error('Redis pipeline execution failed');
      }

      // results[0] = INCR, results[1] = EXPIRE, results[2] = GET
      const currentCount = results[0][1] as number;
      const previousCount = results[2][1]
        ? parseInt(results[2][1] as string, 10)
        : 0;

      // Calcul du ratio pour la sliding window
      // ratio = proportion de la fenêtre courante déjà écoulée (0 à 1)
      const ratio = (now - windowStart) / windowMs;

      // Compte effectif : fenêtre courante + partie de la fenêtre précédente
      // Plus on avance dans la fenêtre courante, moins on compte la fenêtre précédente
      const count = currentCount + previousCount * (1 - ratio);

      const allowed = count <= rateLimitConfig.maxRequests;
      const remaining = Math.max(0, Math.floor(rateLimitConfig.maxRequests - count));
      const reset = windowStart + windowMs;
      
      // Calculer le temps d'attente si limite atteinte
      const waitTime = allowed ? undefined : reset - now;

      return {
        allowed,
        limit: rateLimitConfig.maxRequests,
        remaining,
        reset,
        waitTime,
      };
    } catch (error) {
      // Fail-open avec fallback en mémoire si Redis est down
      this.logger.warn(
        `Redis error in RPC rate limiting for chain ${chainId}, using in-memory fallback: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );

      return this.checkRateLimitInMemory(chainId, rateLimitConfig);
    }
  }

  /**
   * Fallback en mémoire si Redis est down
   */
  private checkRateLimitInMemory(
    chainId: ChainId,
    config: { maxRequests: number; windowMs: number },
  ): RateLimitCheckResult {
    const now = Date.now();
    const key = `chain_${chainId}`;
    const counter = this.inMemoryCounters.get(key);

    if (!counter || now >= counter.reset) {
      // Nouvelle fenêtre
      this.inMemoryCounters.set(key, {
        count: 1,
        reset: now + config.windowMs,
      });
      return {
        allowed: true,
        limit: config.maxRequests,
        remaining: config.maxRequests - 1,
        reset: now + config.windowMs,
      };
    }

    // Fenêtre existante
    if (counter.count >= config.maxRequests) {
      return {
        allowed: false,
        limit: config.maxRequests,
        remaining: 0,
        reset: counter.reset,
        waitTime: counter.reset - now,
      };
    }

    counter.count++;
    return {
      allowed: true,
      limit: config.maxRequests,
      remaining: config.maxRequests - counter.count,
      reset: counter.reset,
    };
  }

  /**
   * Exécute une fonction avec rate limiting
   * Middleware réutilisable pour n'importe quel appel RPC
   * 
   * @param chainId La chaîne pour laquelle appliquer le rate limit
   * @param fn La fonction à exécuter (généralement un appel RPC)
   * @returns Le résultat de la fonction
   */
  async executeWithRateLimit<T>(
    chainId: ChainId,
    fn: () => Promise<T>,
  ): Promise<T> {
    // Vérifier le rate limit
    const result = await this.checkRateLimit(chainId);

    if (!result.allowed && result.waitTime) {
      // Attendre jusqu'à ce que la limite soit disponible
      this.logger.debug(
        `Rate limit reached for chain ${chainId}, waiting ${result.waitTime}ms`,
      );
      await this.sleep(result.waitTime);
      
      // Re-vérifier (au cas où d'autres instances auraient utilisé des slots)
      const recheck = await this.checkRateLimit(chainId);
      if (!recheck.allowed && recheck.waitTime) {
        // Attendre encore un peu
        await this.sleep(recheck.waitTime);
      }
    }

    try {
      // Exécuter la fonction
      return await fn();
    } catch (error) {
      // Si c'est une erreur 429, elle sera gérée par le transport wrapper avec retries
      // On laisse simplement remonter l'erreur
      throw error;
    }
  }

  /**
   * Utilitaire pour attendre un certain temps
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
