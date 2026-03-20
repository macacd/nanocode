# NanoCode

A lightweight AI assistant that runs OpenCode agents in containers. Connects to WhatsApp, Telegram, and more.

```
╔═══════════════════════════════════════════════════════════╗
║   ███╗   ██╗ █████╗ ███╗   ██╗ ██████╗  ██████╗ ██████╗  ║
║   ████╗  ██║██╔══██╗████╗  ██║██╔═══██╗██╔════╝██╔═══██╗ ║
║   ██╔██╗ ██║███████║██╔██╗ ██║██║   ██║██║     ██║   ██║ ║
║   ██║╚██╗██║██╔══██║██║╚██╗██║██║   ██║██║     ██║   ██║ ║
║   ██║ ╚████║██║  ██║██║ ╚████║╚██████╔╝╚██████╗╚██████╔╝ ║
║   ╚═╝  ╚═══╝╚═╝  ╚═╝╚═╝  ╚═══╝ ╚═════╝  ╚═════╝ ╚═════╝  ║
║                                                           ║
║   AI Assistant powered by OpenCode                        ║
╚═══════════════════════════════════════════════════════════╝
```

## Why NanoCode?

Inspired by [NanoClaw](https://github.com/qwibitai/nanoclaw), NanoCode provides:

- **OpenCode as the engine** - Use any LLM provider (Anthropic, OpenAI, or custom)
- **Container isolation** - Agents run in Docker containers for security
- **Multi-channel messaging** - WhatsApp, Telegram, and more
- **Per-group memory** - Each group has its own `AGENTS.md` context file
- **Scheduled tasks** - Run automated jobs on a cron schedule
- **Small codebase** - Easy to understand and customize

## Quick Start

```bash
# Clone the repository
git clone https://github.com/yourusername/nanocode.git
cd nanocode

# Install dependencies
npm install

# Copy and edit environment variables
cp .env.example .env

# Build and run
npm run build
npm start
```

## Configuration

Edit `.env` to configure:

```bash
# Required: At least one LLM API key
ANTHROPIC_API_KEY=your-key-here
# or
OPENAI_API_KEY=your-key-here
# or
OPENCODE_ZEN_API_KEY=your-key-here

# Optional: Enable channels
WHATSAPP_ENABLED=true
TELEGRAM_BOT_TOKEN=your-bot-token

# Customize the trigger word (default: @Andy)
TRIGGER_WORD=@MyBot
```

## Usage

Talk to your assistant with the trigger word:

```
@Andy what's the weather like today?
@Andy remind me to check email every morning at 9am
@Andy summarize the latest news about AI
```

## Architecture

```
Channels (WhatsApp/Telegram) --> SQLite --> Queue --> Container (OpenCode) --> Response
```

- **Single Node.js process** - Simple, no microservices
- **Per-group isolation** - Each group has its own filesystem and AGENTS.md
- **Container execution** - Agents run in Docker with limited resources
- **Concurrent processing** - Multiple groups can be served simultaneously

### Key Files

```
src/
├── index.ts           # Main orchestrator
├── types.ts           # TypeScript types
├── db.ts              # SQLite operations
├── channels/
│   ├── registry.ts    # Channel registration
│   ├── whatsapp.ts    # WhatsApp integration
│   └── telegram.ts    # Telegram integration
├── container-runner.ts # Docker agent execution
├── group-queue.ts     # Per-group message queue
└── task-scheduler.ts  # Cron job scheduler
```

## Requirements

- Node.js 20+
- Docker (optional, for container isolation)
- At least one LLM API key

## Channels

### WhatsApp

Set `WHATSAPP_ENABLED=true` in your `.env`. On first run, scan the QR code with your phone.

### Telegram

1. Create a bot with [@BotFather](https://t.me/botfather)
2. Set `TELEGRAM_BOT_TOKEN` in your `.env`
3. Start chatting with your bot

## Scheduled Tasks

Create scheduled tasks programmatically or through the API:

```typescript
import { createTask } from './db.js';

createTask({
  groupId: 'your-group-id',
  name: 'Morning Briefing',
  description: 'Send a daily briefing',
  cronExpression: '0 9 * * *', // Every day at 9am
  prompt: 'Summarize the latest tech news and send me a briefing',
  isEnabled: true,
});
```

## Development

```bash
# Run in development mode with hot reload
npm run dev

# Run tests
npm test

# Lint
npm run lint

# Format code
npm run format
```

## Security

- Agents run in isolated Docker containers
- Only mounted directories are accessible
- Resource limits (512MB RAM, 1 CPU by default)
- No access to host system

## Contributing

Contributions are welcome! Please feel free to submit issues and pull requests.

## License

MIT

## Credits

Inspired by [NanoClaw](https://github.com/qwibitai/nanoclaw) and powered by [OpenCode](https://opencode.ai).
