import { Cron } from 'croner';
import { getEnabledTasks, updateTaskLastRun, getGroupById } from './db.js';
import { runAgentInContainer } from './container-runner.js';
import { channelRegistry } from './channels/registry.js';
import type { Task, Config } from './types.js';
import path from 'path';

/**
 * Task Scheduler
 * 
 * Manages scheduled tasks (cron jobs) that run OpenCode agents
 * at specified intervals.
 */

interface ScheduledJob {
  task: Task;
  cron: Cron;
}

class TaskScheduler {
  private jobs: Map<string, ScheduledJob> = new Map();
  private config: Config | null = null;
  private isRunning = false;

  /**
   * Initialize the scheduler with config
   */
  initialize(config: Config): void {
    this.config = config;
  }

  /**
   * Start the scheduler
   * Loads all enabled tasks and schedules them
   */
  start(): void {
    if (this.isRunning) {
      console.warn('Scheduler is already running');
      return;
    }

    console.log('⏰ Starting task scheduler...');
    this.loadAndScheduleTasks();
    this.isRunning = true;
    console.log('✅ Task scheduler started');
  }

  /**
   * Stop the scheduler
   */
  stop(): void {
    console.log('⏸️ Stopping task scheduler...');
    
    for (const [taskId, job] of this.jobs) {
      job.cron.stop();
      console.log(`Stopped task: ${job.task.name} (${taskId})`);
    }

    this.jobs.clear();
    this.isRunning = false;
    console.log('✅ Task scheduler stopped');
  }

  /**
   * Load tasks from database and schedule them
   */
  private loadAndScheduleTasks(): void {
    const tasks = getEnabledTasks();
    console.log(`Found ${tasks.length} enabled task(s)`);

    for (const task of tasks) {
      this.scheduleTask(task);
    }
  }

  /**
   * Schedule a single task
   */
  scheduleTask(task: Task): void {
    if (this.jobs.has(task.id)) {
      console.warn(`Task ${task.id} is already scheduled`);
      return;
    }

    try {
      const cron = new Cron(task.cronExpression, {
        name: task.name,
        catch: (error) => {
          console.error(`Error in task ${task.name}:`, error);
        },
      }, () => this.runTask(task));

      this.jobs.set(task.id, { task, cron });

      const nextRun = cron.nextRun();
      console.log(`📅 Scheduled task: ${task.name} (${task.cronExpression})`);
      console.log(`   Next run: ${nextRun?.toLocaleString() || 'N/A'}`);
    } catch (error) {
      console.error(`Failed to schedule task ${task.name}:`, error);
    }
  }

  /**
   * Unschedule a task
   */
  unscheduleTask(taskId: string): void {
    const job = this.jobs.get(taskId);
    if (job) {
      job.cron.stop();
      this.jobs.delete(taskId);
      console.log(`Unscheduled task: ${job.task.name}`);
    }
  }

  /**
   * Run a task immediately
   */
  async runTask(task: Task): Promise<void> {
    if (!this.config) {
      console.error('Scheduler not initialized with config');
      return;
    }

    console.log(`\n🚀 Running scheduled task: ${task.name}`);
    console.log(`   Group: ${task.groupId}`);
    console.log(`   Prompt: ${task.prompt.substring(0, 100)}...`);

    const group = getGroupById(task.groupId);
    if (!group) {
      console.error(`Group ${task.groupId} not found for task ${task.name}`);
      return;
    }

    const groupDir = path.join(process.cwd(), 'groups', task.groupId);

    try {
      const result = await runAgentInContainer({
        groupId: task.groupId,
        prompt: `[Scheduled Task: ${task.name}]\n\n${task.prompt}`,
        groupDir,
        config: this.config,
        timeout: this.config.messageTimeout,
      });

      // Update last run time
      const now = Date.now();
      const job = this.jobs.get(task.id);
      const nextRun = job?.cron.nextRun()?.getTime();
      updateTaskLastRun(task.id, now, nextRun || now + 86400000);

      console.log(`✅ Task completed: ${task.name}`);
      console.log(`   Execution time: ${result.executionTime}ms`);

      // Send result to the group's channel
      if (result.content && !result.error) {
        try {
          const channel = channelRegistry.get(group.channelType);
          if (channel) {
            await channel.sendMessage(group.channelGroupId, result.content);
          }
        } catch (sendError) {
          console.error(`Failed to send task result to channel:`, sendError);
        }
      }

      if (result.error) {
        console.error(`   Error: ${result.error}`);
      }
    } catch (error) {
      console.error(`Failed to run task ${task.name}:`, error);
    }
  }

  /**
   * Refresh a specific task (reload from database)
   */
  refreshTask(taskId: string): void {
    // Unschedule existing
    this.unscheduleTask(taskId);

    // Get fresh task from database
    const tasks = getEnabledTasks();
    const task = tasks.find(t => t.id === taskId);

    if (task) {
      this.scheduleTask(task);
    }
  }

  /**
   * Refresh all tasks
   */
  refreshAll(): void {
    this.stop();
    this.start();
  }

  /**
   * Get status of all scheduled jobs
   */
  getStatus(): Array<{
    taskId: string;
    name: string;
    cronExpression: string;
    nextRun: Date | null;
    isRunning: boolean;
  }> {
    const statuses = [];

    for (const [taskId, job] of this.jobs) {
      statuses.push({
        taskId,
        name: job.task.name,
        cronExpression: job.task.cronExpression,
        nextRun: job.cron.nextRun(),
        isRunning: job.cron.isBusy(),
      });
    }

    return statuses;
  }

  /**
   * Get count of scheduled jobs
   */
  getJobCount(): number {
    return this.jobs.size;
  }

  /**
   * Check if scheduler is running
   */
  getIsRunning(): boolean {
    return this.isRunning;
  }
}

// Export singleton instance
export const taskScheduler = new TaskScheduler();
