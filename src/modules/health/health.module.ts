import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { MongoModule } from 'src/database/mongo/mongo.module';
import { RedisModule } from 'src/database/redis/redis.module';

import { HealthController } from './health.controller';

@Module({
  imports: [TerminusModule, MongoModule, RedisModule],
  controllers: [HealthController],
})
export class HealthModule {}
