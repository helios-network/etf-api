import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { HealthController } from './health.controller';
import { MongoModule } from '../../database/mongo/mongo.module';
import { RedisModule } from '../../database/redis/redis.module';

@Module({
  imports: [TerminusModule, MongoModule, RedisModule],
  controllers: [HealthController],
})
export class HealthModule {}

