import { OnModuleInit } from '@nestjs/common';
import { clusterLogger } from '../utils/cluster-logger';

export function MasterOnly() {
  return function <T extends { new (...args: any[]): {} }>(constructor: T) {
    const className = constructor.name;

    class MasterOnlyClass extends constructor implements OnModuleInit {
      onModuleInit(): void {
        const appRole = process.env.APP_ROLE;
        if (appRole !== 'master') {
          const error = new Error(
            `FATAL: ${className} cannot run in worker process (APP_ROLE=${appRole}). ` +
              'This job must only run in the master process.',
          );
          clusterLogger.error(`[${className}] ${error.message}`);
          throw error;
        }
        clusterLogger.log(`[${className}] initialized in master process (PID: ${process.pid})`);
      }
    }
    Object.defineProperty(MasterOnlyClass, 'name', { value: className });

    return MasterOnlyClass;
  };
}
