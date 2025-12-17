import { Module } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR, APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import cluster from 'cluster';
import configuration from './config/configuration';
import { validationSchema } from './config/validation';
import { MongoModule } from './database/mongo/mongo.module';
import { CacheModule } from './infrastructure/cache/cache.module';
import { RateLimitModule } from './infrastructure/rate-limit/rate-limit.module';
import { RateLimitGuard } from './infrastructure/rate-limit/rate-limit.guard';
import { RpcRateLimitModule } from './services/rpc-rate-limit/rpc-rate-limit.module';
import { HealthModule } from './modules/health/health.module';
import { RewardsModule } from './modules/rewards/rewards.module';
import { EtfsModule } from './modules/etfs/etfs.module';
import { ChainlinkDataFeedsModule } from './modules/chainlink-data-feeds/chainlink-data-feeds.module';
import { LeaderBoardModule } from './modules/leader-board/leader-board.module';
import { PortfolioModule } from './modules/portfolio/portfolio.module';
import { JobsModule } from './modules/jobs/jobs.module';
// import { AdminModule } from './modules/admin/admin.module';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';

function shouldLoadJobsModules(): boolean {
  if (typeof cluster !== 'undefined' && cluster.isPrimary !== undefined) {
    return cluster.isPrimary === true;
  }
  return process.env.APP_ROLE === 'master';
}

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validationSchema,
      validationOptions: {
        allowUnknown: true,
        abortEarly: false,
      },
    }),
    ...(shouldLoadJobsModules()
      ? [ScheduleModule.forRoot(), JobsModule]
      : []),
    MongoModule,
    CacheModule,
    RateLimitModule,
    HealthModule,
    RewardsModule,
    EtfsModule,
    ChainlinkDataFeedsModule,
    LeaderBoardModule,
    PortfolioModule,
    // AdminModule,
  ],
  providers: [
    {
      provide: APP_INTERCEPTOR,
      useClass: LoggingInterceptor,
    },
    {
      provide: APP_FILTER,
      useClass: HttpExceptionFilter,
    },
    {
      provide: APP_GUARD,
      useClass: RateLimitGuard,
    },
  ],
})
export class AppModule {}
