import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { HealthController } from './health.controller';
import { MongoModule } from 'src/database/mongo/mongo.module';
import { RedisModule } from 'src/database/redis/redis.module';

@Module({
  imports: [TerminusModule, MongoModule, RedisModule],
  controllers: [HealthController],
})
export class HealthModule {}
