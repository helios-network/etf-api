import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { FastifyReply, FastifyRequest } from 'fastify';
import { ConfigService } from '@nestjs/config';

/**
 * Exception filter global pour gérer toutes les erreurs HTTP
 * Remplace le middleware d'erreur Express
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  constructor(private readonly configService: ConfigService) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<FastifyReply>();
    const request = ctx.getRequest<FastifyRequest>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal Server Error';
    let errorDetails: any = null;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();
      
      if (typeof exceptionResponse === 'string') {
        message = exceptionResponse;
      } else if (typeof exceptionResponse === 'object') {
        message = (exceptionResponse as any).message || message;
        errorDetails = exceptionResponse;
      }
    } else if (exception instanceof Error) {
      message = exception.message;
      this.logger.error(
        `Unhandled error: ${exception.message}`,
        exception.stack,
      );
    }

    // Log de l'erreur
    this.logger.error(
      `${request.method} ${request.url} - ${status} - ${message}`,
    );

    // Réponse d'erreur
    const errorResponse = {
      error: status === HttpStatus.NOT_FOUND ? 'Not Found' : 'Internal Server Error',
      message:
        status === HttpStatus.NOT_FOUND
          ? `Route ${request.method} ${request.url} not found`
          : this.configService.get<string>('nodeEnv') === 'development'
            ? message
            : 'Something went wrong',
      ...(this.configService.get<string>('nodeEnv') === 'development' && {
        details: errorDetails,
        stack: exception instanceof Error ? exception.stack : undefined,
      }),
      timestamp: new Date().toISOString(),
      path: request.url,
    };

    response.status(status).send(errorResponse);
  }
}
