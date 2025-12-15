import cluster from 'cluster';
import * as os from 'os';
import { bootstrapWorker } from './main';
import { clusterLogger } from './common/utils/cluster-logger';

async function bootstrapMaster(): Promise<void> {
  const appRole = process.env.APP_ROLE;
  
  if (appRole && appRole !== 'master') {
    throw new Error(
      `FATAL: APP_ROLE is set to "${appRole}" but this is the master process. ` +
        'Master process must have APP_ROLE=master or be auto-detected.',
    );
  }

  if (!appRole) {
    process.env.APP_ROLE = 'master';
  }

  clusterLogger.log(`Starting MASTER process (PID: ${process.pid})`);
  clusterLogger.log(`Cron jobs enabled`);

  await bootstrapWorker();
}

async function bootstrapWorkerProcess(): Promise<void> {
  process.env.APP_ROLE = 'worker';

  clusterLogger.log(`Starting WORKER process (PID: ${process.pid})`);
  clusterLogger.log(`HTTP server enabled`);
  clusterLogger.log(`Cron jobs disabled`);

  await bootstrapWorker();
}

async function bootstrap(): Promise<void> {
  if (cluster.isPrimary) {
    const appRole = process.env.APP_ROLE;
    const workerCountEnv = process.env.WORKER_COUNT;
    
    if (!appRole) {
      process.env.APP_ROLE = 'master';
    } else if (appRole !== 'master') {
      throw new Error(
        `FATAL: Primary process must have APP_ROLE=master, got "${appRole}"`,
      );
    }

    const defaultWorkerCount = Math.max(1, os.cpus().length - 1);
    const workerCount = workerCountEnv
      ? parseInt(workerCountEnv, 10)
      : defaultWorkerCount;

    if (isNaN(workerCount) || workerCount < 1) {
      throw new Error(
        `FATAL: WORKER_COUNT must be a positive integer, got "${workerCountEnv}"`,
      );
    }

    clusterLogger.log(`Starting cluster with ${workerCount} worker(s)`);
    clusterLogger.log(`CPU cores available: ${os.cpus().length}`);

    const workerEnv = { ...process.env };
    workerEnv.APP_ROLE = 'worker';
    
    const workers: cluster.Worker[] = [];
    for (let i = 0; i < workerCount; i++) {
      const worker = cluster.fork({ env: workerEnv });
      workers.push(worker);

      worker.on('message', (msg) => {
        clusterLogger.debug(`Message from worker ${worker.process.pid}:`, msg);
      });
    }

    cluster.on('exit', (worker, code, signal) => {
      clusterLogger.warn(
        `Worker ${worker.process.pid} died (code: ${code}, signal: ${signal}). Restarting...`,
      );
      
      const index = workers.indexOf(worker);
      if (index > -1) {
        workers.splice(index, 1);
      }

      const workerEnv = { ...process.env };
      workerEnv.APP_ROLE = 'worker';
      const newWorker = cluster.fork({ env: workerEnv });
      workers.push(newWorker);

      newWorker.on('message', (msg) => {
        clusterLogger.debug(`Message from worker ${newWorker.process.pid}:`, msg);
      });
    });

    const shutdown = (signal: string) => {
      clusterLogger.log(`Received ${signal}, shutting down gracefully...`);
      
      for (const worker of workers) {
        worker.kill();
      }

      process.exit(0);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

    await bootstrapMaster();
  } else {
    process.env.APP_ROLE = 'worker';
    await bootstrapWorkerProcess();
  }
}

bootstrap().catch((error) => {
  clusterLogger.error('Fatal error during bootstrap:', error);
  process.exit(1);
});
