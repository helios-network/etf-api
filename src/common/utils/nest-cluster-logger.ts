import { LoggerService } from '@nestjs/common';
import { clusterLogger } from './cluster-logger';

export class NestClusterLogger implements LoggerService {
  log(message: string, context?: string): void {
    clusterLogger.log(context ? `[${context}] ${message}` : message);
  }

  error(message: string, trace?: string, context?: string): void {
    const fullMessage = context ? `[${context}] ${message}` : message;
    if (trace) {
      clusterLogger.error(`${fullMessage}\n${trace}`);
    } else {
      clusterLogger.error(fullMessage);
    }
  }

  warn(message: string, context?: string): void {
    clusterLogger.warn(context ? `[${context}] ${message}` : message);
  }

  debug(message: string, context?: string): void {
    clusterLogger.debug(context ? `[${context}] ${message}` : message);
  }

  verbose(message: string, context?: string): void {
    clusterLogger.debug(context ? `[${context}] ${message}` : message);
  }
}
