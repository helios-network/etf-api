# Migration Express → NestJS

## État de la migration

### ✅ Éléments migrés

1. **Configuration de base**
   - ✅ CORS configuré (allow all origins)
   - ✅ Middleware de logging → `LoggingInterceptor`
   - ✅ Error handling → `HttpExceptionFilter`
   - ✅ Endpoint GET `/` (bienvenue)
   - ✅ Endpoint GET `/health` (déjà existant avec Terminus)

2. **Structure des modules**
   - ✅ `RewardsModule` - `/api/rewards`
   - ✅ `EtfsModule` - `/api/etfs` et `/etf` (alias)
   - ✅ `ChainlinkDataFeedsModule` - `/api/chainlinkDataFeeds`
   - ✅ `LeaderBoardModule` - `/api/leaderBoard`

3. **Infrastructure**
   - ✅ Dossier `jobs/` créé (prêt pour migration des jobs)

### ⚠️ À compléter

1. **Routes à migrer**
   - [ ] Routes `rewards` depuis `routes/rewards`
   - [ ] Routes `etfs` depuis `routes/etfs`
   - [ ] Routes `chainlinkDataFeeds` depuis `routes/chainlinkDataFeeds`
   - [ ] Routes `leaderBoard` depuis `routes/leaderBoard`

2. **Jobs à migrer**
   - [ ] `jobs/event.ts`
   - [ ] `jobs/reward.ts`
   - [ ] `jobs/chainlink.ts`

3. **Activation des modules**
   - [ ] Décommenter les imports dans `app.module.ts` une fois les routes implémentées

## Structure des routes

### Routes publiques (sans préfixe /api)
- `GET /` - Message de bienvenue
- `GET /health` - Health check
- `GET /etf/*` - Routes ETF (alias)

### Routes API (avec préfixe /api)
- `GET /api/rewards/*` - Routes rewards
- `GET /api/etfs/*` - Routes ETFs
- `GET /api/chainlinkDataFeeds/*` - Routes Chainlink Data Feeds
- `GET /api/leaderBoard/*` - Routes Leader Board

## Différences avec Express

### Middleware → Interceptors/Filters

**Express:**
```typescript
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});
```

**NestJS:**
```typescript
// LoggingInterceptor (déjà implémenté)
@Injectable()
export class LoggingInterceptor implements NestInterceptor { ... }
```

### Error Handling

**Express:**
```typescript
app.use((err, req, res, next) => {
  res.status(500).json({ error: 'Internal Server Error' });
});
```

**NestJS:**
```typescript
// HttpExceptionFilter (déjà implémenté)
@Catch()
export class HttpExceptionFilter implements ExceptionFilter { ... }
```

### Routes

**Express:**
```typescript
app.use('/api/rewards', rewardsRoutes);
```

**NestJS:**
```typescript
@Controller('rewards')
export class RewardsController {
  @Get()
  findAll() { ... }
}
```

## Prochaines étapes

1. **Migrer les routes une par une** dans les controllers correspondants
2. **Migrer la logique métier** dans les services
3. **Migrer les jobs** dans le dossier `src/jobs/`
4. **Tester chaque endpoint** après migration
5. **Activer les modules** dans `app.module.ts` une fois prêts

## Notes importantes

- Le préfixe global `/api` est configuré dans `main.ts`
- Les routes `/`, `/health` et `/etf/*` sont exclues du préfixe
- CORS est configuré pour accepter toutes les origines (comme l'ancienne app)
- Le logging et la gestion d'erreurs sont globaux via interceptors/filters
