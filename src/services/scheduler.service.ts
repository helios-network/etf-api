import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import cron from 'node-cron';

export interface ScheduledTask {
  name: string;
  cronExpression: string;
  task: () => Promise<void> | void;
  running: boolean;
}

@Injectable()
export class SchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SchedulerService.name);
  private tasks: Map<string, cron.ScheduledTask> = new Map();
  private taskMetadata: Map<string, ScheduledTask> = new Map();

  onModuleInit() {
    this.logger.log('SchedulerService initialized');
    this.logger.log('SchedulerService ready to accept task registrations');
  }

  onModuleDestroy() {
    this.logger.log('Stopping all scheduled tasks...');
    this.stopAll();
  }

  /**
   * Register a cron job
   */
  registerTask(
    name: string,
    cronExpression: string,
    task: () => Promise<void> | void,
  ): void {
    this.logger.log(`Registering task: ${name} with expression: ${cronExpression}`);
    
    // Validate cron expression
    if (!cron.validate(cronExpression)) {
      this.logger.error(
        `Invalid cron expression "${cronExpression}" for task "${name}"`,
      );
      return;
    }

    // Stop existing task if any
    if (this.tasks.has(name)) {
      this.logger.warn(`Stopping existing task "${name}"`);
      this.stopTask(name);
    }

    // Create metadata
    const metadata: ScheduledTask = {
      name,
      cronExpression,
      task,
      running: false,
    };
    this.taskMetadata.set(name, metadata);

    // Create and start cron task
    const scheduledTask = cron.schedule(
      cronExpression,
      async () => {
        const taskMeta = this.taskMetadata.get(name);
        if (!taskMeta) {
          this.logger.error(`Task metadata not found for "${name}"`);
          return;
        }

        // Prevent concurrent execution
        if (taskMeta.running) {
          this.logger.debug(
            `Task "${name}" is already running, skipping this execution`,
          );
          return;
        }

        taskMeta.running = true;
        const startTime = Date.now();

        try {
          this.logger.log(`Executing scheduled task: ${name}`);
          await task();
          const duration = Date.now() - startTime;
          this.logger.log(
            `Task "${name}" completed successfully in ${duration}ms`,
          );
        } catch (error) {
          const duration = Date.now() - startTime;
          this.logger.error(
            `Task "${name}" failed after ${duration}ms:`,
            error instanceof Error ? error.message : String(error),
            error instanceof Error ? error.stack : undefined,
          );
        } finally {
          taskMeta.running = false;
        }
      },
      {
        scheduled: true,
        timezone: 'UTC',
      },
    );

    this.tasks.set(name, scheduledTask);
    this.logger.log(
      `Registered scheduled task "${name}" with expression "${cronExpression}"`,
    );
  }

  /**
   * Stop a specific task
   */
  stopTask(name: string): void {
    const task = this.tasks.get(name);
    if (task) {
      task.stop();
      this.tasks.delete(name);
      this.logger.log(`Stopped task "${name}"`);
    }
  }

  /**
   * Stop all tasks
   */
  stopAll(): void {
    for (const [name, task] of this.tasks.entries()) {
      task.stop();
      this.logger.log(`Stopped task "${name}"`);
    }
    this.tasks.clear();
    this.taskMetadata.clear();
  }

  /**
   * Get status of all tasks
   */
  getStatus(): Array<{ name: string; cronExpression: string; running: boolean }> {
    return Array.from(this.taskMetadata.values()).map((meta) => ({
      name: meta.name,
      cronExpression: meta.cronExpression,
      running: meta.running,
    }));
  }
}

