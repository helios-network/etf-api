import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { ValidationPipe, RequestMethod, Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import { ConfigService } from '@nestjs/config';

async function bootstrap() {
  const nodeEnv = process.env.NODE_ENV || 'development';
  
  const fastifyAdapter = new FastifyAdapter({
    logger: /*nodeEnv === 'production' ?*/ false /*: true*/,
    bodyLimit: 1048576,
    disableRequestLogging: nodeEnv === 'production',
  });

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    fastifyAdapter,
  );

  const logger = new Logger('Bootstrap');
  const configService = app.get(ConfigService);
  const port = configService.get<number>('port', 3000);
  const appNodeEnv = configService.get<string>('nodeEnv', 'development');
  const corsConfig = configService.get<{ enabled: boolean; origins: string[] | string }>('cors');

  if (corsConfig?.enabled !== false) {
    const corsOrigins = corsConfig?.origins || (nodeEnv === 'production' ? [] : '*');
    
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
      { path: '/', method: RequestMethod.GET },
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

  await app.listen(port, '0.0.0.0');
  logger.log(`🚀 Server is running on http://localhost:${port}`);
  logger.log(`📝 Environment: ${appNodeEnv}`);
}
bootstrap();
