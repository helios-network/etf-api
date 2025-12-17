import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { RedisModule } from '../../database/redis/redis.module';
import { RpcRateLimitService } from './rpc-rate-limit.service';
import { RpcRotationService } from './rpc-rotation.service';

@Module({
  imports: [ConfigModule, RedisModule],
  providers: [RpcRateLimitService, RpcRotationService],
  exports: [RpcRateLimitService, RpcRotationService],
})
export class RpcRateLimitModule {}
