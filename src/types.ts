import { z } from 'zod';

// ============================================================================
// Channel Types
// ============================================================================

export const ChannelType = z.enum(['whatsapp', 'telegram', 'discord', 'slack']);
export type ChannelType = z.infer<typeof ChannelType>;

export interface Channel {
  type: ChannelType;
  name: string;
  isEnabled: () => boolean;
  initialize: () => Promise<void>;
  sendMessage: (groupId: string, message: string) => Promise<void>;
  onMessage: (handler: MessageHandler) => void;
}

// ============================================================================
// Message Types
// ============================================================================

export const MessageSchema = z.object({
  id: z.string(),
  groupId: z.string(),
  channelType: ChannelType,
  senderId: z.string(),
  senderName: z.string(),
  content: z.string(),
  timestamp: z.number(),
  isFromBot: z.boolean().default(false),
  metadata: z.record(z.unknown()).optional(),
});

export type Message = z.infer<typeof MessageSchema>;

export type MessageHandler = (message: Message) => Promise<void>;

// ============================================================================
// Group Types
// ============================================================================

export const GroupSchema = z.object({
  id: z.string(),
  name: z.string(),
  channelType: ChannelType,
  channelGroupId: z.string(), // Original ID from the channel (WhatsApp, Telegram, etc.)
  isMain: z.boolean().default(false), // Main channel for admin control
  createdAt: z.number(),
  updatedAt: z.number(),
  metadata: z.record(z.unknown()).optional(),
});

export type Group = z.infer<typeof GroupSchema>;

// ============================================================================
// Task Types (Scheduled Jobs)
// ============================================================================

export const TaskSchema = z.object({
  id: z.string(),
  groupId: z.string(),
  name: z.string(),
  description: z.string(),
  cronExpression: z.string(),
  prompt: z.string(), // What to ask OpenCode
  isEnabled: z.boolean().default(true),
  lastRunAt: z.number().optional(),
  nextRunAt: z.number().optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export type Task = z.infer<typeof TaskSchema>;

// ============================================================================
// Session Types (Agent Conversations)
// ============================================================================

export const SessionSchema = z.object({
  id: z.string(),
  groupId: z.string(),
  startedAt: z.number(),
  lastMessageAt: z.number(),
  messageCount: z.number(),
  isActive: z.boolean().default(true),
});

export type Session = z.infer<typeof SessionSchema>;

// ============================================================================
// Agent Response Types
// ============================================================================

export interface AgentResponse {
  content: string;
  error?: string;
  executionTime: number;
}

// ============================================================================
// Configuration Types
// ============================================================================

export const ConfigSchema = z.object({
  triggerWord: z.string().default('@Andy'),
  defaultModel: z.string().default('anthropic/claude-sonnet-4-20250514'),
  maxConcurrentAgents: z.number().default(3),
  messageTimeout: z.number().default(120000), // 2 minutes
  containerRuntime: z.enum(['docker', 'none']).default('docker'),
});

export type Config = z.infer<typeof ConfigSchema>;

// ============================================================================
// Queue Types
// ============================================================================

export interface QueuedMessage {
  message: Message;
  addedAt: number;
  retries: number;
}

export interface GroupQueue {
  groupId: string;
  messages: QueuedMessage[];
  isProcessing: boolean;
}
