import { Injectable, Logger } from '@nestjs/common';
import { FastifyRequest } from 'fastify';
import { RedisService } from '../../database/redis/redis.service';
import { ConfigService } from '@nestjs/config';
import { RATE_LIMIT_CONSTANTS } from './rate-limit.constants';

/**
 * Résultat d'une vérification de rate limit
 */
export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  reset: number; // Timestamp en millisecondes
}

/**
 * Service de rate limiting distribué avec Redis
 * Implémente un algorithme de sliding window pour une protection précise
 */
@Injectable()
export class RateLimitService {
  private readonly logger = new Logger(RateLimitService.name);

  constructor(
    private readonly redisService: RedisService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Extrait l'identifiant du client depuis la requête
   * Pour l'instant, utilise l'IP. Peut être étendu avec user ID, API key, etc.
   */
  getIdentifier(request: FastifyRequest): string {
    // Fastify fournit request.ip qui gère les proxies (X-Forwarded-For)
    const ip = request.ip || request.socket?.remoteAddress || 'unknown';
    return ip;
  }

  /**
   * Vérifie si la requête est autorisée selon les limites configurées
   * Implémente un algorithme de sliding window pour éviter les bursts
   *
   * @param identifier Identifiant unique du client (IP, user ID, etc.)
   * @param windowMs Durée de la fenêtre en millisecondes
   * @param maxRequests Nombre maximum de requêtes autorisées dans la fenêtre
   * @returns Résultat avec allowed, limit, remaining, reset
   */
  async checkLimit(
    identifier: string,
    windowMs: number,
    maxRequests: number,
  ): Promise<RateLimitResult> {
    try {
      const now = Date.now();
      const windowStart = Math.floor(now / windowMs) * windowMs;
      const previousWindowStart = windowStart - windowMs;

      const namespace = this.configService.get<string>(
        'rateLimit.namespace',
        RATE_LIMIT_CONSTANTS.DEFAULT_NAMESPACE,
      );

      const key = `${namespace}${RATE_LIMIT_CONSTANTS.KEY_SEPARATOR}${identifier}${RATE_LIMIT_CONSTANTS.KEY_SEPARATOR}${windowStart}`;
      const prevKey = `${namespace}${RATE_LIMIT_CONSTANTS.KEY_SEPARATOR}${identifier}${RATE_LIMIT_CONSTANTS.KEY_SEPARATOR}${previousWindowStart}`;

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

      const allowed = count <= maxRequests;
      const remaining = Math.max(0, Math.floor(maxRequests - count));
      const reset = windowStart + windowMs;

      return {
        allowed,
        limit: maxRequests,
        remaining,
        reset,
      };
    } catch (error) {
      // Fail-open : ne jamais bloquer l'API si Redis est down
      this.logger.warn(
        `Redis error in rate limiting, failing open: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );

      return {
        allowed: true,
        limit: maxRequests,
        remaining: maxRequests,
        reset: Date.now() + windowMs,
      };
    }
  }
}
