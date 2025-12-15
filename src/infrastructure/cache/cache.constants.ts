/**
 * Constantes pour le système de cache
 */
export const CACHE_CONSTANTS = {
  /**
   * Séparateur utilisé dans les clés de cache
   */
  KEY_SEPARATOR: ':',

  /**
   * Namespace par défaut si aucun n'est spécifié
   */
  DEFAULT_NAMESPACE: 'default',

  /**
   * Préfixe de clé par défaut si le cache est désactivé
   * (utilisé pour éviter les collisions si réactivé)
   */
  DISABLED_PREFIX: 'disabled',
} as const;
