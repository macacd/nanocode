import 'dotenv/config';
import path from 'path';
import { initDatabase, closeDatabase, saveMessage, getRecentMessages, getGroupById } from './db.js';
import { registerChannels, channelRegistry } from './channels/index.js';
import { groupQueueManager } from './group-queue.js';
import { taskScheduler } from './task-scheduler.js';
import { runAgentInContainer, isDockerAvailable, ensureImageExists } from './container-runner.js';
import type { Message, Config } from './types.js';
import { loadSecrets } from './secrets.js';

/**
 * NanoCode - A lightweight AI assistant using OpenCode
 * 
 * Main orchestrator that coordinates:
 * - Message channels (WhatsApp, Telegram, etc.)
 * - Agent execution in containers
 * - Per-group message queues
 * - Scheduled tasks
 */

// Default configuration
const DEFAULT_CONFIG: Config = {
  triggerWord: process.env['TRIGGER_WORD'] || '@Andy',
  defaultModel: process.env['DEFAULT_MODEL'] || 'anthropic/claude-sonnet-4-20250514',
  maxConcurrentAgents: parseInt(process.env['MAX_CONCURRENT_AGENTS'] || '3', 10),
  messageTimeout: parseInt(process.env['MESSAGE_TIMEOUT'] || '120000', 10),
  containerRuntime: (process.env['CONTAINER_RUNTIME'] as 'docker' | 'none') || 'docker',
};

let config: Config = DEFAULT_CONFIG;
let isShuttingDown = false;

/**
 * Main entry point
 */
async function main(): Promise<void> {
  console.log(`
╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║   ███╗   ██╗ █████╗ ███╗   ██╗ ██████╗  ██████╗ ██████╗  ║
║   ████╗  ██║██╔══██╗████╗  ██║██╔═══██╗██╔════╝██╔═══██╗ ║
║   ██╔██╗ ██║███████║██╔██╗ ██║██║   ██║██║     ██║   ██║ ║
║   ██║╚██╗██║██╔══██║██║╚██╗██║██║   ██║██║     ██║   ██║ ║
║   ██║ ╚████║██║  ██║██║ ╚████║╚██████╔╝╚██████╗╚██████╔╝ ║
║   ╚═╝  ╚═══╝╚═╝  ╚═╝╚═╝  ╚═══╝ ╚═════╝  ╚═════╝ ╚═════╝  ║
║                                                           ║
║   AI Assistant powered by OpenCode                        ║
╚═══════════════════════════════════════════════════════════╝
`);

  console.log('🚀 Starting NanoCode...\n');

  // Load secrets from AWS SSM Parameter Store if available
  await loadSecrets();

  // Initialize database
  console.log('📦 Initializing database...');
  initDatabase();
  console.log('✅ Database ready\n');

  // Check Docker availability if using containers
  if (config.containerRuntime === 'docker') {
    console.log('🐳 Checking Docker...');
    const dockerAvailable = await isDockerAvailable();
    
    if (!dockerAvailable) {
      console.warn('⚠️ Docker is not available. Running without container isolation.');
      config.containerRuntime = 'none';
    } else {
      console.log('✅ Docker is available');
      await ensureImageExists();
    }
    console.log('');
  }

  // Set up message handler
  groupQueueManager.setProcessHandler(handleMessage);
  groupQueueManager.setMaxConcurrent(config.maxConcurrentAgents);

  // Register and initialize channels
  registerChannels();

  // Set up channel message handling
  channelRegistry.setMessageHandler(async (message: Message) => {
    // Check if message should trigger the bot
    if (shouldProcessMessage(message)) {
      // Save message to database
      saveMessage(message);
      
      // Add to processing queue
      groupQueueManager.enqueue(message);
    }
  });

  // Initialize all channels
  console.log('📡 Initializing channels...\n');
  await channelRegistry.initializeAll();

  // Start task scheduler
  taskScheduler.initialize(config);
  taskScheduler.start();

  // Print status
  printStatus();

  // Set up graceful shutdown
  setupShutdown();

  console.log('\n✅ NanoCode is running!\n');
  console.log(`Trigger word: ${config.triggerWord}`);
  console.log(`Max concurrent agents: ${config.maxConcurrentAgents}`);
  console.log(`Container runtime: ${config.containerRuntime}`);
  console.log('\nWaiting for messages...\n');
}

/**
 * Check if a message should be processed by the bot
 */
function shouldProcessMessage(message: Message): boolean {
  // Don't process bot's own messages
  if (message.isFromBot) {
    return false;
  }

  // Determine if it's a group chat based on channel metadata
  let isGroupChat = true; // Assume group by default to be safe
  if (message.channelType === 'whatsapp' && message.metadata && 'isGroup' in message.metadata) {
    isGroupChat = message.metadata.isGroup as boolean;
  }

  // If it's a private chat (not a group), process all messages
  if (!isGroupChat) {
    return true;
  }

  // For groups, check for trigger word
  const triggerWord = config.triggerWord.toLowerCase();
  const content = message.content.toLowerCase();

  return content.includes(triggerWord);
}

/**
 * Handle an incoming message
 */
async function handleMessage(message: Message): Promise<void> {
  console.log(`\n📨 Processing message from ${message.senderName}`);
  console.log(`   Group: ${message.groupId}`);
  console.log(`   Content: ${message.content.substring(0, 100)}...`);

  const group = getGroupById(message.groupId);
  if (!group) {
    console.error('Group not found for message');
    return;
  }

  // Get group directory
  const groupDir = path.join(process.cwd(), 'groups', message.groupId);

  // Get recent conversation history for context
  const recentMessages = getRecentMessages(message.groupId, 20);
  const conversationHistory = formatConversationHistory(recentMessages);

  // Remove trigger word from prompt
  const prompt = message.content.replace(new RegExp(config.triggerWord, 'gi'), '').trim();

  try {
    // Run the agent
    const result = await runAgentInContainer({
      groupId: message.groupId,
      prompt: `User: ${message.senderName}\nMessage: ${prompt}`,
      groupDir,
      config,
      conversationHistory,
      timeout: config.messageTimeout,
    });

    console.log(`✅ Agent responded in ${result.executionTime}ms`);

    // Send response back to channel
    const channel = channelRegistry.get(group.channelType);
    if (channel) {
      await channel.sendMessage(group.channelGroupId, result.content);

      // Save bot's response to database
      saveMessage({
        groupId: message.groupId,
        channelType: group.channelType,
        senderId: 'nanocode',
        senderName: 'NanoCode',
        content: result.content,
        timestamp: Date.now(),
        isFromBot: true,
      });
    }

    if (result.error) {
      console.error(`   Error: ${result.error}`);
    }
  } catch (error) {
    console.error('Error processing message:', error);

    // Try to send error message to user
    try {
      const channel = channelRegistry.get(group.channelType);
      if (channel) {
        await channel.sendMessage(
          group.channelGroupId,
          "I'm sorry, I encountered an error processing your message. Please try again."
        );
      }
    } catch {
      // Ignore send errors
    }
  }
}

/**
 * Format conversation history for context
 */
function formatConversationHistory(messages: Message[]): string {
  if (messages.length === 0) return '';

  return messages
    .map((m) => `[${new Date(m.timestamp).toLocaleString()}] ${m.senderName}: ${m.content}`)
    .join('\n');
}

/**
 * Print current status
 */
function printStatus(): void {
  console.log('\n📊 Status:');
  console.log(`   Channels: ${channelRegistry.count} registered`);
  console.log(`   Scheduled tasks: ${taskScheduler.getJobCount()}`);
  console.log(`   Pending messages: ${groupQueueManager.getTotalPending()}`);
  console.log(`   Active agents: ${groupQueueManager.getActiveCount()}`);
}

/**
 * Set up graceful shutdown handlers
 */
function setupShutdown(): void {
  const shutdown = async (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    console.log(`\n\n⏹️ Received ${signal}. Shutting down gracefully...`);

    // Stop accepting new messages
    taskScheduler.stop();

    // Wait for active processing to complete (with timeout)
    const maxWait = 30000; // 30 seconds
    const startTime = Date.now();

    while (groupQueueManager.getActiveCount() > 0) {
      if (Date.now() - startTime > maxWait) {
        console.log('⚠️ Timeout waiting for active agents. Forcing shutdown.');
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    // Close database
    closeDatabase();

    console.log('👋 Goodbye!\n');
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

// Run main
main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
