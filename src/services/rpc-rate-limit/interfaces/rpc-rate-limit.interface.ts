import { ChainId } from '../../../config/web3';

/**
 * Configuration pour les limites de taux RPC par chaîne
 */
export interface RpcRateLimitConfig {
  maxRequests: number;
  windowMs: number;
}

/**
 * Configuration pour les retries RPC
 */
export interface RpcRetryConfig {
  maxRetries: number;
  baseDelay: number; // en millisecondes
  maxDelay: number; // en millisecondes
}

/**
 * Configuration complète RPC
 */
export interface RpcConfig {
  rateLimits: Record<ChainId, RpcRateLimitConfig>;
  retry: RpcRetryConfig;
}

/**
 * Résultat d'une vérification de rate limit
 */
export interface RateLimitCheckResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  reset: number; // timestamp en millisecondes
  waitTime?: number; // temps d'attente en ms si limite atteinte
}
