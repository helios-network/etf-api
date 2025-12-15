import chalk from 'chalk';
import cluster from 'cluster';

const WORKER_COLORS = [
  chalk.cyan,
  chalk.green,
  chalk.yellow,
  chalk.magenta,
  chalk.blue,
  chalk.gray,
  chalk.white,
  chalk.cyanBright,
  chalk.greenBright,
  chalk.yellowBright,
  chalk.magentaBright,
  chalk.blueBright,
  chalk.blueBright,
  chalk.cyanBright,
];

function getWorkerInfo(): { id: string; color: typeof chalk; prefix: string } {
  if (cluster.isPrimary) {
    return {
      id: 'MASTER',
      color: chalk.bold.white.bgBlue,
      prefix: '[MASTER]',
    };
  }

  const workerId = cluster.worker?.id || 0;
  const color = WORKER_COLORS[workerId % WORKER_COLORS.length];
  const pid = process.pid;

  return {
    id: `WORKER-${workerId}`,
    color,
    prefix: `[W${workerId}:${pid}]`,
  };
}

export class ClusterLogger {
  private workerInfo = getWorkerInfo();

  private formatMessage(level: string, message: string, ...args: any[]): string {
    const { color, prefix } = this.workerInfo;
    
    const formattedMessage = color(`${prefix} [${level}] ${message}`);
        const formattedArgs = args.length > 0 
      ? ' ' + args.map(arg => 
          typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
        ).join(' ')
      : '';

    return `${formattedMessage}${formattedArgs}`;
  }

  log(message: string, ...args: any[]): void {
    console.log(this.formatMessage('LOG', message, ...args));
  }

  info(message: string, ...args: any[]): void {
    console.info(this.formatMessage('INFO', message, ...args));
  }

  warn(message: string, ...args: any[]): void {
    console.warn(chalk.yellow(this.formatMessage('WARN', message, ...args)));
  }

  error(message: string, ...args: any[]): void {
    console.error(chalk.red(this.formatMessage('ERROR', message, ...args)));
  }

  debug(message: string, ...args: any[]): void {
    console.debug(chalk.gray(this.formatMessage('DEBUG', message, ...args)));
  }

  success(message: string, ...args: any[]): void {
    console.log(chalk.green(this.formatMessage('SUCCESS', message, ...args)));
  }
}

export const clusterLogger = new ClusterLogger();
