import { Controller, Get } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckService,
  HealthCheckResult,
  HealthIndicatorResult,
  MongooseHealthIndicator,
} from '@nestjs/terminus';
import { RedisService } from 'src/database/redis/redis.service';
import { BypassRateLimit } from 'src/infrastructure/rate-limit/rate-limit.guard';

@Controller('health')
export class HealthController {
  constructor(
    private health: HealthCheckService,
    private mongoose: MongooseHealthIndicator,
    private redisService: RedisService,
  ) {}

  @Get()
  @HealthCheck()
  @BypassRateLimit()
  check(): Promise<HealthCheckResult> {
    return this.health.check([
      () => this.mongoose.pingCheck('mongodb'),
      () => this.checkRedis(),
    ]);
  }

  private async checkRedis(): Promise<HealthIndicatorResult> {
    try {
      const client = this.redisService.getClient();
      const result = await client.ping();
      return {
        redis: {
          status: result === 'PONG' ? 'up' : 'down',
          message: result === 'PONG' ? 'Redis is healthy' : 'Redis ping failed',
        },
      } as HealthIndicatorResult;
    } catch (error: any) {
      return {
        redis: {
          status: 'down',
          message: error?.message || 'Redis connection failed',
        },
      } as HealthIndicatorResult;
    }
  }
}

