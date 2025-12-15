import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { clusterLogger } from '../utils/cluster-logger';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const { method, url } = request;
    const now = Date.now();

    clusterLogger.debug(`→ ${method} ${url}`);

    return next.handle().pipe(
      tap(() => {
        const response = context.switchToHttp().getResponse();
        const { statusCode } = response;
        const delay = Date.now() - now;
        const statusColor = statusCode >= 400 ? 'error' : statusCode >= 300 ? 'warn' : 'log';
        
        if (statusColor === 'error') {
          clusterLogger.error(`← ${method} ${url} ${statusCode} - ${delay}ms`);
        } else if (statusColor === 'warn') {
          clusterLogger.warn(`← ${method} ${url} ${statusCode} - ${delay}ms`);
        } else {
          clusterLogger.debug(`← ${method} ${url} ${statusCode} - ${delay}ms`);
        }
      }),
    );
  }
}
