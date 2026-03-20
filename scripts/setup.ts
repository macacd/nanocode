#!/usr/bin/env tsx
/**
 * NanoCode Setup Script
 * 
 * Interactive setup wizard for configuring NanoCode
 */

import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { spawn } from 'child_process';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function question(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      resolve(answer.trim());
    });
  });
}

async function main() {
  console.log(`
╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║            NanoCode Setup Wizard                          ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
`);

  const envPath = path.join(process.cwd(), '.env');
  let envContent = '';

  // Check if .env exists
  if (fs.existsSync(envPath)) {
    const overwrite = await question('.env file already exists. Overwrite? (y/N): ');
    if (overwrite.toLowerCase() !== 'y') {
      console.log('Keeping existing .env file.');
      envContent = fs.readFileSync(envPath, 'utf-8');
    }
  }

  // Start fresh if no content
  if (!envContent) {
    envContent = fs.readFileSync(
      path.join(process.cwd(), '.env.example'),
      'utf-8'
    );
  }

  console.log('\n📝 Configuration\n');

  // Trigger word
  const triggerWord = await question('Trigger word (default: @Andy): ') || '@Andy';
  envContent = envContent.replace(/TRIGGER_WORD=.*/, `TRIGGER_WORD=${triggerWord}`);

  // LLM Provider
  console.log('\n🤖 LLM Provider\n');
  console.log('Choose your LLM provider:');
  console.log('1. Anthropic (Claude)');
  console.log('2. OpenAI');
  console.log('3. OpenCode Zen');
  console.log('4. Custom (enter later)\n');

  const providerChoice = await question('Select provider (1-4): ');

  switch (providerChoice) {
    case '1':
      const anthropicKey = await question('Enter your Anthropic API key: ');
      if (anthropicKey) {
        envContent = envContent.replace(/ANTHROPIC_API_KEY=.*/, `ANTHROPIC_API_KEY=${anthropicKey}`);
      }
      break;
    case '2':
      const openaiKey = await question('Enter your OpenAI API key: ');
      if (openaiKey) {
        envContent = envContent.replace(/OPENAI_API_KEY=.*/, `OPENAI_API_KEY=${openaiKey}`);
      }
      break;
    case '3':
      console.log('\nGet your OpenCode Zen API key at: https://opencode.ai/auth');
      const zenKey = await question('Enter your OpenCode Zen API key: ');
      if (zenKey) {
        envContent = envContent.replace(/OPENCODE_ZEN_API_KEY=.*/, `OPENCODE_ZEN_API_KEY=${zenKey}`);
      }
      break;
  }

  // Channels
  console.log('\n📱 Messaging Channels\n');

  // WhatsApp
  const enableWhatsApp = await question('Enable WhatsApp? (y/N): ');
  if (enableWhatsApp.toLowerCase() === 'y') {
    envContent = envContent.replace(/WHATSAPP_ENABLED=.*/, 'WHATSAPP_ENABLED=true');
    console.log('WhatsApp enabled. QR code will be shown on first run.');
  }

  // Telegram
  const enableTelegram = await question('Enable Telegram? (y/N): ');
  if (enableTelegram.toLowerCase() === 'y') {
    console.log('\nTo create a Telegram bot:');
    console.log('1. Open Telegram and search for @BotFather');
    console.log('2. Send /newbot and follow the instructions');
    console.log('3. Copy the API token\n');
    
    const telegramToken = await question('Enter your Telegram bot token: ');
    if (telegramToken) {
      envContent = envContent.replace(/TELEGRAM_BOT_TOKEN=.*/, `TELEGRAM_BOT_TOKEN=${telegramToken}`);
    }

    const telegramAdminId = await question('Enter your Telegram user ID (optional, for admin): ');
    if (telegramAdminId) {
      envContent = envContent.replace(/TELEGRAM_ADMIN_ID=.*/, `TELEGRAM_ADMIN_ID=${telegramAdminId}`);
    }
  }

  // Container runtime
  console.log('\n🐳 Container Runtime\n');
  const useDocker = await question('Use Docker for agent isolation? (Y/n): ');
  if (useDocker.toLowerCase() === 'n') {
    envContent = envContent.replace(/CONTAINER_RUNTIME=.*/, 'CONTAINER_RUNTIME=none');
    console.log('Running without Docker isolation.');
  } else {
    // Check if Docker is available
    console.log('Checking Docker...');
    const dockerAvailable = await checkDocker();
    if (!dockerAvailable) {
      console.log('⚠️ Docker not found. Install Docker or run without isolation.');
      envContent = envContent.replace(/CONTAINER_RUNTIME=.*/, 'CONTAINER_RUNTIME=none');
    } else {
      console.log('✅ Docker is available');
    }
  }

  // Save .env
  fs.writeFileSync(envPath, envContent);
  console.log('\n✅ Configuration saved to .env\n');

  // Create necessary directories
  console.log('📁 Creating directories...');
  fs.mkdirSync(path.join(process.cwd(), 'data'), { recursive: true });
  fs.mkdirSync(path.join(process.cwd(), 'groups'), { recursive: true });
  console.log('✅ Directories created\n');

  // Build
  const build = await question('Build the project now? (Y/n): ');
  if (build.toLowerCase() !== 'n') {
    console.log('\n🔨 Building...');
    await runCommand('npm', ['run', 'build']);
    console.log('✅ Build complete\n');
  }

  console.log(`
╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║   Setup Complete!                                         ║
║                                                           ║
║   Run NanoCode with:                                      ║
║   $ npm start                                             ║
║                                                           ║
║   Or in development mode:                                 ║
║   $ npm run dev                                           ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
`);

  rl.close();
}

async function checkDocker(): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn('docker', ['version'], { stdio: 'pipe' });
    proc.on('close', (code) => resolve(code === 0));
    proc.on('error', () => resolve(false));
  });
}

async function runCommand(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, { stdio: 'inherit' });
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Command failed with code ${code}`));
    });
    proc.on('error', reject);
  });
}

main().catch((error) => {
  console.error('Setup failed:', error);
  process.exit(1);
});
