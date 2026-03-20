import { Bot, Context } from 'grammy';
import type { Channel, Message, MessageHandler } from '../types.js';
import { getGroupByChannelId, createGroup } from '../db.js';
import { nanoid } from 'nanoid';

/**
 * Telegram Channel Implementation
 * Uses grammy for Telegram Bot API
 */
export class TelegramChannel implements Channel {
  type = 'telegram' as const;
  name = 'Telegram';

  private bot: Bot | null = null;
  private messageHandler: MessageHandler | null = null;
  private isReady = false;

  /**
   * Check if Telegram is enabled (has bot token)
   */
  isEnabled(): boolean {
    return !!process.env['TELEGRAM_BOT_TOKEN'];
  }

  /**
   * Initialize the Telegram bot
   */
  async initialize(): Promise<void> {
    const token = process.env['TELEGRAM_BOT_TOKEN'];
    if (!token) {
      throw new Error('TELEGRAM_BOT_TOKEN is not set');
    }

    this.bot = new Bot(token);

    // Handle incoming messages
    this.bot.on('message:text', async (ctx: Context) => {
      if (!this.messageHandler) return;
      if (!ctx.message || !ctx.chat) return;

      try {
        const chatId = ctx.chat.id.toString();
        let group = getGroupByChannelId('telegram', chatId);

        if (!group) {
          // Determine chat name
          let chatName = 'Telegram Chat';
          if (ctx.chat.type === 'private') {
            chatName = `DM: ${ctx.chat.first_name || 'User'}`;
          } else if ('title' in ctx.chat) {
            chatName = ctx.chat.title;
          }

          // Create new group
          group = createGroup({
            name: chatName,
            channelType: 'telegram',
            channelGroupId: chatId,
            isMain: ctx.chat.type === 'private' && ctx.from?.id.toString() === process.env['TELEGRAM_ADMIN_ID'],
          });
        }

        const senderName = ctx.from
          ? `${ctx.from.first_name || ''}${ctx.from.last_name ? ' ' + ctx.from.last_name : ''}`.trim() || 'Unknown'
          : 'Unknown';

        const message: Message = {
          id: nanoid(),
          groupId: group.id,
          channelType: 'telegram',
          senderId: ctx.from?.id.toString() || 'unknown',
          senderName,
          content: ctx.message.text || '',
          timestamp: ctx.message.date * 1000,
          isFromBot: ctx.from?.is_bot || false,
          metadata: {
            chatType: ctx.chat.type,
            messageId: ctx.message.message_id,
          },
        };

        await this.messageHandler(message);
      } catch (error) {
        console.error('Error processing Telegram message:', error);
      }
    });

    // Handle errors
    this.bot.catch((err) => {
      console.error('Telegram bot error:', err);
    });

    // Start the bot
    console.log('🚀 Starting Telegram bot...');
    
    // Get bot info
    const me = await this.bot.api.getMe();
    console.log(`✅ Telegram bot ready: @${me.username}`);
    
    // Start polling (non-blocking)
    this.bot.start({
      onStart: () => {
        this.isReady = true;
        console.log('✅ Telegram bot is now polling for messages');
      },
    });
  }

  /**
   * Send a message to a Telegram chat
   */
  async sendMessage(groupId: string, message: string): Promise<void> {
    if (!this.bot || !this.isReady) {
      throw new Error('Telegram bot is not ready');
    }

    // groupId here is the channel_group_id (Telegram chat ID)
    await this.bot.api.sendMessage(groupId, message, {
      parse_mode: 'Markdown',
    });
  }

  /**
   * Set the message handler
   */
  onMessage(handler: MessageHandler): void {
    this.messageHandler = handler;
  }

  /**
   * Stop the bot
   */
  async stop(): Promise<void> {
    if (this.bot) {
      await this.bot.stop();
      this.isReady = false;
    }
  }
}

// Export singleton instance
export const telegramChannel = new TelegramChannel();
