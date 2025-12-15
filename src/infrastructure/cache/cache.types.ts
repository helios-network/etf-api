/**
 * Options pour les opérations de cache
 */
export interface CacheOptions {
  /**
   * Time To Live en secondes
   * Si non spécifié, utilise le TTL par défaut de la configuration
   */
  ttl?: number;

  /**
   * Namespace/Module pour le préfixe de clé
   * Si non spécifié, utilise 'default'
   */
  namespace?: string;
}

/**
 * Fonction pour récupérer des données depuis la source (DB, API, etc.)
 */
export type CacheFetcher<T> = () => Promise<T>;

/**
 * Options pour la construction de clés de cache
 */
export interface CacheKeyOptions {
  /**
   * Namespace/Module pour le préfixe
   */
  namespace?: string;

  /**
   * Clé de base (sans préfixe)
   */
  key: string;
}
