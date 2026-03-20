/**
 * Channel Registration
 * 
 * This file imports all channel implementations and registers them
 * with the channel registry. Channels self-register at startup if
 * their credentials are configured.
 */

import { channelRegistry } from './registry.js';
import { whatsappChannel } from './whatsapp.js';
import { telegramChannel } from './telegram.js';

/**
 * Register all available channels
 * Channels will only be registered if their credentials are configured
 */
export function registerChannels(): void {
  console.log('📡 Registering channels...\n');

  // Register WhatsApp
  channelRegistry.register(whatsappChannel);

  // Register Telegram
  channelRegistry.register(telegramChannel);

  // Add more channels here as they are implemented
  // channelRegistry.register(discordChannel);
  // channelRegistry.register(slackChannel);

  console.log(`\n✅ Registered ${channelRegistry.count} channel(s)\n`);
}

export { channelRegistry } from './registry.js';
export { whatsappChannel } from './whatsapp.js';
export { telegramChannel } from './telegram.js';
