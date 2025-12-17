import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { RedisModule } from '../../database/redis/redis.module';
import { RpcRateLimitService } from './rpc-rate-limit.service';

/**
 * Module de rate limiting pour les appels RPC
 * Fournit un service middleware réutilisable pour gérer les limites de taux RPC
 */
@Module({
  imports: [ConfigModule, RedisModule],
  providers: [RpcRateLimitService],
  exports: [RpcRateLimitService],
})
export class RpcRateLimitModule {}
