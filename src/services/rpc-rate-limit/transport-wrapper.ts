import { http, type HttpTransport } from 'viem';
import { RpcRetryConfig } from './interfaces';


/**
 * Crée un transport HTTP viem avec gestion des retries
 * 
 * Note: Viem utilise un exponential backoff par défaut avec la formule:
 * delay = (1 << count) * retryDelay
 * 
 * Le rate limiting principal est géré par RpcRateLimitService avant l'appel RPC.
 * Ici, on configure juste les retries de base pour gérer les erreurs temporaires.
 * 
 * @param url L'URL du RPC endpoint
 * @param retryConfig Configuration pour les retries
 * @returns Un transport HTTP configuré
 */
export function createRateLimitedTransport(
  url: string,
  retryConfig: RpcRetryConfig,
): HttpTransport {
  return http(url, {
    retryCount: retryConfig.maxRetries,
    // retryDelay est en millisecondes, viem applique exponential backoff automatiquement
    // La formule viem: delay = (1 << count) * retryDelay
    // Pour avoir ~baseDelay au premier retry, on divise par 2
    retryDelay: Math.max(100, Math.floor(retryConfig.baseDelay / 2)),
  });
}
