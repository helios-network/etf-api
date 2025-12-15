import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { FastifyReply, FastifyRequest } from 'fastify';
import { ConfigService } from '@nestjs/config';
import { clusterLogger } from '../utils/cluster-logger';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
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
      clusterLogger.error(
        `Unhandled error: ${exception.message}`,
        exception.stack,
      );
    }

    const isDevelopment = this.configService.get<string>('nodeEnv') === 'development';
    const isNotFound = status === HttpStatus.NOT_FOUND;

    if (!isNotFound || isDevelopment) {
      if (status >= 500) {
        clusterLogger.error(`${request.method} ${request.url} - ${status} - ${message}`);
      } else if (status >= 400) {
        clusterLogger.warn(`${request.method} ${request.url} - ${status} - ${message}`);
      }
    }

    if (isNotFound) {
      const errorResponse = {
        error: 'Not Found',
        message: `Route ${request.method} ${request.url} not found`,
        statusCode: status,
        timestamp: new Date().toISOString(),
        path: request.url,
      };
      return response.status(status).send(errorResponse);
    }

    const errorResponse: any = {
      error: status >= 500 ? 'Internal Server Error' : 'Bad Request',
      message: isDevelopment ? message : (status >= 500 ? 'Something went wrong' : message),
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: request.url,
    };

    if (isDevelopment) {
      if (errorDetails) {
        errorResponse.details = errorDetails;
      }
      if (exception instanceof Error && exception.stack) {
        errorResponse.stack = exception.stack;
      }
    }

    response.status(status).send(errorResponse);
  }
}
