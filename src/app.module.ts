import { Module } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import configuration from './config/configuration';
import { validationSchema } from './config/validation';
import { MongoModule } from './database/mongo/mongo.module';
import { RedisModule } from './database/redis/redis.module';
import { CacheModule } from './infrastructure/cache/cache.module';
import { HealthModule } from './modules/health/health.module';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';

@Module({
  imports: [
    // Configuration must be imported first
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validationSchema,
      validationOptions: {
        allowUnknown: true,
        abortEarly: false,
      },
    }),
    MongoModule,
    RedisModule,
    CacheModule,
    HealthModule,
    // Modules de routes migrés depuis Express
    // TODO: Décommenter une fois les routes implémentées
    // RewardsModule,
    // EtfsModule,
    // ChainlinkDataFeedsModule,
    // LeaderBoardModule,
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
  ],
})
export class AppModule {}
