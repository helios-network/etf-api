/**
 * Constantes pour le système de rate limiting distribué
 */
export const RATE_LIMIT_CONSTANTS = {
  /**
   * Namespace Redis par défaut pour les clés de rate limiting
   */
  DEFAULT_NAMESPACE: 'ratelimit',

  /**
   * Séparateur utilisé dans les clés Redis
   */
  KEY_SEPARATOR: ':',

  /**
   * Headers HTTP standards pour le rate limiting
   */
  HEADERS: {
    LIMIT: 'X-RateLimit-Limit',
    REMAINING: 'X-RateLimit-Remaining',
    RESET: 'X-RateLimit-Reset',
  },

  /**
   * Messages d'erreur
   */
  MESSAGES: {
    TOO_MANY_REQUESTS: 'Too many requests, please try again later',
  },
} as const;

/**
 * Clé de métadonnée pour le décorateur @BypassRateLimit
 */
export const BYPASS_RATE_LIMIT_KEY = 'bypass_rate_limit';
