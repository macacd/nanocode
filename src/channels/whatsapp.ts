import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;
import type { Channel, Message, MessageHandler } from '../types.js';
import { getGroupByChannelId, createGroup } from '../db.js';
import { nanoid } from 'nanoid';

/**
 * WhatsApp Channel Implementation
 * Uses whatsapp-web.js for WhatsApp Web automation
 */
export class WhatsAppChannel implements Channel {
  type = 'whatsapp' as const;
  name = 'WhatsApp';

  private client: InstanceType<typeof Client> | null = null;
  private messageHandler: MessageHandler | null = null;
  private isReady = false;

  /**
   * Check if WhatsApp is enabled (has session or will create one)
   */
  isEnabled(): boolean {
    // WhatsApp is enabled if we want to use it
    // Authentication happens via QR code on first run
    return process.env['WHATSAPP_ENABLED'] === 'true';
  }

  /**
   * Initialize the WhatsApp client
   */
  async initialize(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.client = new Client({
        authStrategy: new LocalAuth({
          dataPath: './data/whatsapp-session',
        }),
        puppeteer: {
          headless: true,
          args: ['--no-sandbox', '--disable-setuid-sandbox'],
        },
      });

      this.client.on('qr', (qr) => {
        console.log('\n📱 WhatsApp QR Code - Scan with your phone:');
        // Generate QR code in terminal
        import('qrcode-terminal').then((qrcode) => {
          qrcode.default.generate(qr, { small: true });
        }).catch(() => {
          console.log('QR Code:', qr);
        });
      });

      this.client.on('ready', () => {
        console.log('✅ WhatsApp client is ready');
        this.isReady = true;
        resolve();
      });

      this.client.on('authenticated', () => {
        console.log('✅ WhatsApp authenticated');
      });

      this.client.on('auth_failure', (msg) => {
        console.error('❌ WhatsApp authentication failed:', msg);
        reject(new Error(`WhatsApp auth failed: ${msg}`));
      });

      this.client.on('disconnected', (reason) => {
        console.log('⚠️ WhatsApp disconnected:', reason);
        this.isReady = false;
      });

      // Handle incoming messages
      this.client.on('message', async (msg) => {
        if (!this.messageHandler) return;

        try {
          const chat = await msg.getChat();
          const contact = await msg.getContact();

          // Get or create group
          const chatId = chat.id._serialized;
          let group = getGroupByChannelId('whatsapp', chatId);

          if (!group) {
            // Create new group
            group = createGroup({
              name: chat.name || 'WhatsApp Chat',
              channelType: 'whatsapp',
              channelGroupId: chatId,
              isMain: chat.id.user === this.client?.info.wid.user, // Self-chat is main
            });
          }

          const message: Message = {
            id: nanoid(),
            groupId: group.id,
            channelType: 'whatsapp',
            senderId: contact.id._serialized,
            senderName: contact.pushname || contact.name || 'Unknown',
            content: msg.body,
            timestamp: msg.timestamp * 1000,
            isFromBot: msg.fromMe,
            metadata: {
              hasMedia: msg.hasMedia,
              type: msg.type,
              isGroup: chat.isGroup,
            },
          };

          await this.messageHandler(message);
        } catch (error) {
          console.error('Error processing WhatsApp message:', error);
        }
      });

      this.client.initialize().catch(reject);
    });
  }

  /**
   * Send a message to a WhatsApp chat
   */
  async sendMessage(groupId: string, message: string): Promise<void> {
    if (!this.client || !this.isReady) {
      throw new Error('WhatsApp client is not ready');
    }

    // groupId here is the channel_group_id (WhatsApp chat ID)
    await this.client.sendMessage(groupId, message);
  }

  /**
   * Set the message handler
   */
  onMessage(handler: MessageHandler): void {
    this.messageHandler = handler;
  }

  /**
   * Get the WhatsApp client info
   */
  getInfo(): { wid: string; pushname: string } | null {
    if (!this.client || !this.isReady) return null;
    return {
      wid: this.client.info.wid._serialized,
      pushname: this.client.info.pushname,
    };
  }

  /**
   * Destroy the client
   */
  async destroy(): Promise<void> {
    if (this.client) {
      await this.client.destroy();
      this.client = null;
      this.isReady = false;
    }
  }
}

// Export singleton instance
export const whatsappChannel = new WhatsAppChannel();
