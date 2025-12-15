# Système de Cache Redis

Ce module fournit un système de cache Redis robuste et global pour l'application NestJS.

## Architecture

Le système utilise le pattern **cache-aside** :
- Lecture : vérifie le cache, si absent → DB, puis stocke dans le cache
- Écriture : invalide le cache après mutation

## Configuration

Variables d'environnement requises :

```env
CACHE_ENABLED=true          # Activer/désactiver le cache
CACHE_TTL=300               # TTL par défaut en secondes (5 min)
CACHE_NAMESPACE=etf_api     # Préfixe pour toutes les clés Redis
```

## Utilisation

### Injection dans un service

```typescript
import { Injectable } from '@nestjs/common';
import { CacheService } from '../infrastructure/cache/cache.service';

@Injectable()
export class UserService {
  constructor(private readonly cacheService: CacheService) {}
  
  // ... vos méthodes
}
```

### Pattern cache-aside simple

```typescript
async findById(id: string): Promise<User> {
  return this.cacheService.wrap(
    `user:${id}`,
    () => this.userModel.findById(id).exec(),
    { 
      ttl: 600,              // 10 minutes
      namespace: 'users'     // Module namespace
    }
  );
}
```

### Pattern cache-aside avec liste paginée

```typescript
async findAll(page: number, limit: number): Promise<User[]> {
  return this.cacheService.wrap(
    `users:page:${page}:limit:${limit}`,
    () => this.userModel
      .find()
      .skip(page * limit)
      .limit(limit)
      .exec(),
    { 
      ttl: 300,              // 5 minutes (plus court pour les listes)
      namespace: 'users'
    }
  );
}
```

### Invalidation après mutation

```typescript
async update(id: string, data: UpdateUserDto): Promise<User> {
  // 1. Mettre à jour en DB
  const user = await this.userModel.findByIdAndUpdate(id, data).exec();
  
  // 2. Invalider les caches concernés
  await this.cacheService.del(`user:${id}`, { namespace: 'users' });
  
  // 3. Invalider toutes les listes paginées
  await this.cacheService.delPattern('users:page:*', { namespace: 'users' });
  
  return user;
}

async create(data: CreateUserDto): Promise<User> {
  const user = await this.userModel.create(data);
  
  // Invalider les listes (le nouvel utilisateur pourrait apparaître)
  await this.cacheService.delPattern('users:page:*', { namespace: 'users' });
  
  return user;
}

async delete(id: string): Promise<void> {
  await this.userModel.findByIdAndDelete(id).exec();
  
  // Invalider l'utilisateur et les listes
  await this.cacheService.del(`user:${id}`, { namespace: 'users' });
  await this.cacheService.delPattern('users:page:*', { namespace: 'users' });
}
```

### Opérations manuelles (avancé)

```typescript
// Récupération directe
const cached = await this.cacheService.get<User>('user:123', { namespace: 'users' });

// Stockage direct
await this.cacheService.set('user:123', userData, { 
  ttl: 600, 
  namespace: 'users' 
});

// Suppression directe
await this.cacheService.del('user:123', { namespace: 'users' });

// Récupération multiple
const users = await this.cacheService.mget<User>(
  ['user:1', 'user:2', 'user:3'],
  { namespace: 'users' }
);

// Stockage multiple
await this.cacheService.mset(
  {
    'user:1': user1,
    'user:2': user2,
    'user:3': user3,
  },
  { ttl: 600, namespace: 'users' }
);
```

## Structure des clés de cache

Les clés sont automatiquement préfixées avec le format :
```
{namespace}:{env}:{module}:{key}
```

Exemple avec `CACHE_NAMESPACE=etf_api`, `NODE_ENV=production`, namespace `users`, key `user:123` :
```
etf_api:production:users:user:123
```

## Bonnes pratiques

### ✅ À faire

- **Toujours utiliser `wrap()`** pour le cache-aside (évite les race conditions)
- **TTL courts par défaut** (5-15 min) pour les données dynamiques
- **TTL plus longs** (30-60 min) pour les données semi-statiques
- **Invalider après chaque mutation** (create/update/delete)
- **Utiliser des clés descriptives** et structurées
- **Tester avec cache désactivé** pour vérifier la logique métier

### ❌ À éviter

- ❌ **Ne pas cacher les écritures** (POST/PUT/DELETE)
- ❌ **Ne pas utiliser de TTL trop longs** (risque de données obsolètes)
- ❌ **Ne pas oublier les invalidations** après mutations
- ❌ **Ne pas accéder Redis directement** (toujours via CacheService)
- ❌ **Ne pas cacher des données sensibles** sans réflexion
- ❌ **Ne pas utiliser le cache comme source de vérité** (toujours fallback DB)

## Gestion d'erreurs

Le service gère automatiquement les erreurs :
- **Redis down** : fallback silencieux vers DB (pas d'erreur pour l'utilisateur)
- **Cache désactivé** : comportement no-op (retour direct du fetcher)
- **Erreurs de cache** : logs en mode développement, fallback vers DB

## Exemples de cas d'usage

### Données coûteuses en DB

```typescript
async getExpensiveCalculation(id: string): Promise<CalculationResult> {
  return this.cacheService.wrap(
    `calculation:${id}`,
    () => this.performHeavyCalculation(id), // Opération coûteuse
    { ttl: 3600, namespace: 'calculations' } // 1 heure
  );
}
```

### Données semi-statiques

```typescript
async getConfiguration(): Promise<AppConfig> {
  return this.cacheService.wrap(
    'app:config',
    () => this.configModel.findOne().exec(),
    { ttl: 1800, namespace: 'config' } // 30 minutes
  );
}
```

### Résultats de recherche

```typescript
async search(query: string, filters: SearchFilters): Promise<SearchResult> {
  const cacheKey = `search:${query}:${JSON.stringify(filters)}`;
  
  return this.cacheService.wrap(
    cacheKey,
    () => this.performSearch(query, filters),
    { ttl: 300, namespace: 'search' } // 5 minutes
  );
}
```

## Désactivation du cache

Pour désactiver le cache (tests, développement) :

```env
CACHE_ENABLED=false
```

Toutes les opérations deviennent des no-ops et le fetcher est exécuté directement.
