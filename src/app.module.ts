import { Module } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR, APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import configuration from './config/configuration';
import { validationSchema } from './config/validation';
import { MongoModule } from './database/mongo/mongo.module';
import { CacheModule } from './infrastructure/cache/cache.module';
import { RateLimitModule } from './infrastructure/rate-limit/rate-limit.module';
import { RateLimitGuard } from './infrastructure/rate-limit/rate-limit.guard';
import { HealthModule } from './modules/health/health.module';
import { RewardsModule } from './modules/rewards/rewards.module';
import { EtfsModule } from './modules/etfs/etfs.module';
import { ChainlinkDataFeedsModule } from './modules/chainlink-data-feeds/chainlink-data-feeds.module';
import { LeaderBoardModule } from './modules/leader-board/leader-board.module';
import { JobsModule } from './modules/jobs/jobs.module';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validationSchema,
      validationOptions: {
        allowUnknown: process.env.NODE_ENV !== 'production',
        abortEarly: false,
      },
    }),
    ScheduleModule.forRoot(),
    MongoModule,
    CacheModule,
    RateLimitModule,
    HealthModule,
    RewardsModule,
    EtfsModule,
    ChainlinkDataFeedsModule,
    LeaderBoardModule,
    JobsModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
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
