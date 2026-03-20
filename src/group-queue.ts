import type { Message, QueuedMessage, GroupQueue } from './types.js';

/**
 * Group Queue Manager
 * 
 * Manages per-group message queues with global concurrency control.
 * Ensures messages within a group are processed sequentially while
 * allowing parallel processing across different groups.
 */

type ProcessHandler = (message: Message) => Promise<void>;

class GroupQueueManager {
  private queues: Map<string, GroupQueue> = new Map();
  private processHandler: ProcessHandler | null = null;
  private maxConcurrent: number;
  private activeProcessing: number = 0;
  private maxRetries: number = 3;

  constructor(maxConcurrent = 3) {
    this.maxConcurrent = maxConcurrent;
  }

  /**
   * Set the handler for processing messages
   */
  setProcessHandler(handler: ProcessHandler): void {
    this.processHandler = handler;
  }

  /**
   * Set maximum concurrent processing
   */
  setMaxConcurrent(max: number): void {
    this.maxConcurrent = max;
  }

  /**
   * Add a message to the queue for its group
   */
  enqueue(message: Message): void {
    const { groupId } = message;

    // Get or create queue for this group
    let queue = this.queues.get(groupId);
    if (!queue) {
      queue = {
        groupId,
        messages: [],
        isProcessing: false,
      };
      this.queues.set(groupId, queue);
    }

    // Add message to queue
    queue.messages.push({
      message,
      addedAt: Date.now(),
      retries: 0,
    });

    console.log(`📥 Queued message for group ${groupId}. Queue size: ${queue.messages.length}`);

    // Try to process
    this.tryProcessNext();
  }

  /**
   * Try to process the next available message
   */
  private tryProcessNext(): void {
    if (!this.processHandler) {
      console.warn('No process handler set');
      return;
    }

    if (this.activeProcessing >= this.maxConcurrent) {
      return;
    }

    // Find a queue that has messages and isn't currently processing
    for (const queue of this.queues.values()) {
      if (queue.messages.length > 0 && !queue.isProcessing) {
        this.processQueue(queue);
        return;
      }
    }
  }

  /**
   * Process messages in a queue
   */
  private async processQueue(queue: GroupQueue): Promise<void> {
    if (!this.processHandler) return;

    queue.isProcessing = true;
    this.activeProcessing++;

    while (queue.messages.length > 0) {
      const queuedMessage = queue.messages[0];
      if (!queuedMessage) break;

      try {
        console.log(`🔄 Processing message for group ${queue.groupId}`);
        await this.processHandler(queuedMessage.message);
        queue.messages.shift(); // Remove processed message
      } catch (error) {
        console.error(`Error processing message for group ${queue.groupId}:`, error);
        
        queuedMessage.retries++;
        
        if (queuedMessage.retries >= this.maxRetries) {
          console.error(`Max retries reached for message in group ${queue.groupId}. Discarding.`);
          queue.messages.shift();
        } else {
          // Move to back of queue for retry
          queue.messages.shift();
          queue.messages.push(queuedMessage);
          break; // Stop processing this queue, move to next
        }
      }
    }

    queue.isProcessing = false;
    this.activeProcessing--;

    // Try to process next queue
    this.tryProcessNext();
  }

  /**
   * Get queue status for a group
   */
  getQueueStatus(groupId: string): { size: number; isProcessing: boolean } | null {
    const queue = this.queues.get(groupId);
    if (!queue) return null;

    return {
      size: queue.messages.length,
      isProcessing: queue.isProcessing,
    };
  }

  /**
   * Get all queue statuses
   */
  getAllQueueStatuses(): Map<string, { size: number; isProcessing: boolean }> {
    const statuses = new Map<string, { size: number; isProcessing: boolean }>();

    for (const [groupId, queue] of this.queues) {
      statuses.set(groupId, {
        size: queue.messages.length,
        isProcessing: queue.isProcessing,
      });
    }

    return statuses;
  }

  /**
   * Get total pending messages across all queues
   */
  getTotalPending(): number {
    let total = 0;
    for (const queue of this.queues.values()) {
      total += queue.messages.length;
    }
    return total;
  }

  /**
   * Get active processing count
   */
  getActiveCount(): number {
    return this.activeProcessing;
  }

  /**
   * Clear queue for a specific group
   */
  clearQueue(groupId: string): void {
    const queue = this.queues.get(groupId);
    if (queue) {
      queue.messages = [];
    }
  }

  /**
   * Clear all queues
   */
  clearAll(): void {
    for (const queue of this.queues.values()) {
      queue.messages = [];
    }
  }
}

// Export singleton instance
export const groupQueueManager = new GroupQueueManager();
