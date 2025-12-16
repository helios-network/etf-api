import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { ValidationPipe, RequestMethod, Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import { ConfigService } from '@nestjs/config';
import { clusterLogger } from './common/utils/cluster-logger';
import { NestClusterLogger } from './common/utils/nest-cluster-logger';

export async function bootstrapWorker(): Promise<void> {
  const nodeEnv = 'development';
  const appRole = process.env.APP_ROLE || 'worker';
  
  const fastifyAdapter = new FastifyAdapter({
    logger: false,
    bodyLimit: 1048576,
    disableRequestLogging: true,
  });

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    fastifyAdapter,
    {
      logger: new NestClusterLogger(),
    },
  );

  const logger = new Logger('Bootstrap');
  const configService = app.get(ConfigService);
  const port = configService.get<number>('port', 3000);
  const appNodeEnv = configService.get<string>('nodeEnv', 'development');
  const corsConfig = configService.get<{ enabled: boolean; origins: string[] | string }>('cors');

  if (corsConfig?.enabled !== false) {
    const corsOrigins = corsConfig?.origins || '*';
    
    if (!corsConfig?.origins) {
      logger.warn(
        'WARNING: CORS_ORIGINS is not set in production. CORS is disabled (empty array). ' +
          'If you need CORS, explicitly set CORS_ORIGINS environment variable.',
      );
    }
    
    app.enableCors({
      origin: corsOrigins,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
      allowedHeaders: [
        'Origin',
        'X-Requested-With',
        'Content-Type',
        'Accept',
        'Authorization',
      ],
      credentials: false,
    });
  } else {
    logger.warn('CORS is disabled via configuration.');
  }

  app.setGlobalPrefix('api', {
    exclude: [
      { path: '/health', method: RequestMethod.GET },
      { path: '/etf', method: RequestMethod.ALL },
    ],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  if (appRole === 'master') {
    // Initialize the app to trigger lifecycle hooks and register cron jobs
    await app.init();
    clusterLogger.log(`HTTP server disabled (master mode)`);
    clusterLogger.log(`Cron jobs enabled`);
    clusterLogger.log(`Process PID: ${process.pid}`);
  } else {
    await app.listen(port, '0.0.0.0');
    clusterLogger.success(`🚀 Server is running on http://localhost:${port}`);
    clusterLogger.log(`HTTP server enabled`);
    clusterLogger.log(`Cron jobs disabled`);
    clusterLogger.log(`Process PID: ${process.pid}`);
  }
  
  clusterLogger.log(`📝 Environment: ${appNodeEnv}`);
}
