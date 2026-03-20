import type { Channel, ChannelType, MessageHandler } from '../types.js';

/**
 * Channel Registry - Manages all messaging channels
 * Channels self-register at startup if their credentials are configured
 */
class ChannelRegistry {
  private channels: Map<ChannelType, Channel> = new Map();
  private messageHandler: MessageHandler | null = null;

  /**
   * Register a channel
   */
  register(channel: Channel): void {
    if (this.channels.has(channel.type)) {
      console.warn(`Channel ${channel.type} is already registered. Skipping.`);
      return;
    }

    if (!channel.isEnabled()) {
      console.log(`Channel ${channel.type} is not enabled (missing credentials). Skipping.`);
      return;
    }

    this.channels.set(channel.type, channel);
    console.log(`Registered channel: ${channel.name} (${channel.type})`);

    // Set up message handler if one exists
    if (this.messageHandler) {
      channel.onMessage(this.messageHandler);
    }
  }

  /**
   * Get a channel by type
   */
  get(type: ChannelType): Channel | undefined {
    return this.channels.get(type);
  }

  /**
   * Get all registered channels
   */
  getAll(): Channel[] {
    return Array.from(this.channels.values());
  }

  /**
   * Get all enabled channel types
   */
  getEnabledTypes(): ChannelType[] {
    return Array.from(this.channels.keys());
  }

  /**
   * Check if a channel type is registered
   */
  has(type: ChannelType): boolean {
    return this.channels.has(type);
  }

  /**
   * Set the global message handler for all channels
   */
  setMessageHandler(handler: MessageHandler): void {
    this.messageHandler = handler;

    // Apply to all registered channels
    for (const channel of this.channels.values()) {
      channel.onMessage(handler);
    }
  }

  /**
   * Initialize all registered channels
   */
  async initializeAll(): Promise<void> {
    const results = await Promise.allSettled(
      Array.from(this.channels.values()).map(async (channel) => {
        try {
          await channel.initialize();
          console.log(`Initialized channel: ${channel.name}`);
        } catch (error) {
          console.error(`Failed to initialize channel ${channel.name}:`, error);
          throw error;
        }
      })
    );

    const failed = results.filter((r) => r.status === 'rejected');
    if (failed.length > 0) {
      console.warn(`${failed.length} channel(s) failed to initialize`);
    }
  }

  /**
   * Send a message through a specific channel
   */
  async sendMessage(channelType: ChannelType, groupId: string, message: string): Promise<void> {
    const channel = this.channels.get(channelType);
    if (!channel) {
      throw new Error(`Channel ${channelType} is not registered`);
    }

    await channel.sendMessage(groupId, message);
  }

  /**
   * Get the count of registered channels
   */
  get count(): number {
    return this.channels.size;
  }
}

// Export singleton instance
export const channelRegistry = new ChannelRegistry();

// Export for type safety
export type { Channel, ChannelType };
