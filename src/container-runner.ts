import { spawn, execSync, type ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';
import type { AgentResponse, Config } from './types.js';

/**
 * Container Runner
 * 
 * Executes OpenCode agents in Docker containers for isolation.
 * Each group gets its own container with only its filesystem mounted.
 */

const CONTAINER_IMAGE = 'nanocode-agent:latest';
const DEFAULT_TIMEOUT = 120000; // 2 minutes

interface RunOptions {
  groupId: string;
  prompt: string;
  groupDir: string;
  config: Config;
  conversationHistory?: string;
  timeout?: number;
}

/**
 * Check if Docker is available
 */
export async function isDockerAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn('docker', ['version'], { stdio: 'pipe' });
    proc.on('close', (code) => resolve(code === 0));
    proc.on('error', () => resolve(false));
  });
}

/**
 * Build the agent Docker image if it doesn't exist
 */
export async function ensureImageExists(): Promise<void> {
  const hasImage = await checkImageExists();
  if (!hasImage) {
    console.log('🐳 Building NanoCode agent Docker image...');
    await buildImage();
  }
}

async function checkImageExists(): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn('docker', ['image', 'inspect', CONTAINER_IMAGE], {
      stdio: 'pipe',
    });
    proc.on('close', (code) => resolve(code === 0));
    proc.on('error', () => resolve(false));
  });
}

async function buildImage(): Promise<void> {
  const dockerfilePath = path.join(process.cwd(), 'container', 'Dockerfile');
  
  if (!fs.existsSync(dockerfilePath)) {
    throw new Error('Dockerfile not found at container/Dockerfile');
  }

  return new Promise((resolve, reject) => {
    const proc = spawn('docker', ['build', '-t', CONTAINER_IMAGE, '-f', dockerfilePath, '.'], {
      stdio: 'inherit',
    });

    proc.on('close', (code) => {
      if (code === 0) {
        console.log('✅ Docker image built successfully');
        resolve();
      } else {
        reject(new Error(`Docker build failed with code ${code}`));
      }
    });

    proc.on('error', reject);
  });
}

/**
 * Run an OpenCode agent in a container
 */
export async function runAgentInContainer(options: RunOptions): Promise<AgentResponse> {
  const { groupId, prompt, groupDir, config, conversationHistory, timeout = DEFAULT_TIMEOUT } = options;

  const startTime = Date.now();

  // Ensure group directory exists
  if (!fs.existsSync(groupDir)) {
    fs.mkdirSync(groupDir, { recursive: true });
  }

  // Ensure OpenCode MCP server config exists
  const mcpConfigPath = path.join(groupDir, 'mcp.json');
  if (!fs.existsSync(mcpConfigPath)) {
    const mcpConfig = {
      "mcpServers": {
        "google-workspace": {
          "command": "node",
          "args": ["/mcp/google-workspace/index.js"]
        }
      }
    };
    fs.writeFileSync(mcpConfigPath, JSON.stringify(mcpConfig, null, 2));
  }

  // Ensure AGENTS.md exists for the group
  const agentsFile = path.join(groupDir, 'AGENTS.md');
  if (!fs.existsSync(agentsFile)) {
    fs.writeFileSync(agentsFile, getDefaultAgentsTemplate(groupId));
  }

  // Build the full prompt with context
  const fullPrompt = buildPrompt(prompt, conversationHistory);

  // Run in container or directly based on config
  if (config.containerRuntime === 'docker') {
    return runInDocker(groupId, groupDir, fullPrompt, timeout, startTime, config.defaultModel);
  } else {
    return runDirectly(groupDir, fullPrompt, timeout, startTime, config.defaultModel);
  }
}

/**
 * Run OpenCode in a Docker container
 */
async function runInDocker(
  groupId: string,
  groupDir: string,
  prompt: string,
  timeout: number,
  startTime: number,
  model?: string
): Promise<AgentResponse> {
  return new Promise((resolve) => {
    const containerName = `nanocode-${groupId}-${Date.now()}`;
    
    // Docker run arguments
    const args = [
      'run',
      '--rm',
      '--name', containerName,
      // Mount group directory as workspace
      '-v', `${path.resolve(groupDir)}:/workspace:rw`,
      // Mount global skills directory
      '-v', `${path.resolve(process.cwd(), 'skills')}:/skills:ro`,
      // Mount built MCP directory to the container
      '-v', `${path.resolve(process.cwd(), 'dist', 'mcp')}:/mcp:ro`,
      // Mount node_modules so the MCP server has its dependencies
      '-v', `${path.resolve(process.cwd(), 'node_modules')}:/workspace/node_modules:ro`,
      // Pass environment variables
      '-e', `ANTHROPIC_API_KEY=${process.env['ANTHROPIC_API_KEY'] || ''}`,
      '-e', `OPENAI_API_KEY=${process.env['OPENAI_API_KEY'] || ''}`,
      '-e', `OPENCODE_ZEN_API_KEY=${process.env['OPENCODE_ZEN_API_KEY'] || ''}`,
      '-e', `GOOGLE_GENERATIVE_AI_API_KEY=${process.env['GOOGLE_GENERATIVE_AI_API_KEY'] || ''}`,
      '-e', `GOOGLE_CLIENT_ID=${process.env['GOOGLE_CLIENT_ID'] || ''}`,
      '-e', `GOOGLE_CLIENT_SECRET=${process.env['GOOGLE_CLIENT_SECRET'] || ''}`,
      '-e', `GOOGLE_REFRESH_TOKEN=${process.env['GOOGLE_REFRESH_TOKEN'] || ''}`,
      // Set working directory
      '-w', '/workspace',
      // Resource limits
      '--memory', '512m',
      '--cpus', '1',
      // Network (allow for web access)
      '--network', 'bridge',
      // Image
      CONTAINER_IMAGE,
      // Command Wrapper
      'bash',
      '-c',
      `NODE_PATH=/workspace/node_modules node /mcp/google-workspace/index.js & MCP_PID=\$!; sleep 3; opencode run ${model ? `--model ${model}` : ''} "${prompt.replace(/"/g, '\\"')}"; kill \$MCP_PID 2>/dev/null`
    ];

    let stdout = '';
    let stderr = '';

    const proc = spawn('docker', args, { stdio: 'pipe' });

    // Set timeout
    const timeoutId = setTimeout(() => {
      proc.kill('SIGTERM');
      // Force kill container
      spawn('docker', ['kill', containerName], { stdio: 'ignore' });
    }, timeout);

    proc.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      clearTimeout(timeoutId);
      
      const executionTime = Date.now() - startTime;
      const cleanOutput = cleanAnsiCodes(stdout);

      if (code === 0) {
        resolve({
          content: cleanOutput || 'Task completed.',
          executionTime,
        });
      } else {
        const stderrStr = stderr ? cleanAnsiCodes(stderr) : '';
        resolve({
          content: cleanOutput || 'An error occurred.',
          error: stderrStr || `Process exited with code ${code}`,
          executionTime,
        });
      }
    });

    proc.on('error', (err) => {
      clearTimeout(timeoutId);
      resolve({
        content: '',
        error: `Failed to start container: ${err.message}`,
        executionTime: Date.now() - startTime,
      });
    });
  });
}

/**
 * Run OpenCode directly (no container)
 * Uses execSync because spawn doesn't work properly with opencode CLI
 */
async function runDirectly(
  groupDir: string,
  prompt: string,
  timeout: number,
  startTime: number,
  model?: string
): Promise<AgentResponse> {
  // Escape quotes in the prompt
  const escapedPrompt = prompt.replace(/"/g, '\\"');
  
  // Build command with explicit model if provided
  let command = `opencode run`;
  if (model) {
    command += ` --model ${model}`;
  }
  command += ` "${escapedPrompt}"`;
  
  console.log(`🤖 Running: ${command}`);
  console.log(`   Directory: ${groupDir}`);
  
  try {
    const stdout = execSync(command, {
      cwd: groupDir,
      encoding: 'utf8',
      timeout: timeout,
      env: {
        ...process.env,
        HOME: process.env['HOME'],
        PATH: process.env['PATH'],
      },
      maxBuffer: 10 * 1024 * 1024, // 10MB
    });
    
    const executionTime = Date.now() - startTime;
    
    // Clean ANSI codes from output
    const cleanOutput = cleanAnsiCodes(stdout);
    
    console.log(`✅ Response received in ${executionTime}ms`);
    
    return {
      content: cleanOutput || 'Task completed.',
      executionTime,
    };
  } catch (error: any) {
    const executionTime = Date.now() - startTime;
    
    // execSync throws on non-zero exit, but stdout may still have content
    const stdout = error.stdout ? cleanAnsiCodes(error.stdout.toString()) : '';
    const stderr = error.stderr ? error.stderr.toString() : '';
    
    console.log(`❌ Error after ${executionTime}ms: ${error.message}`);
    
    return {
      content: stdout || 'An error occurred.',
      error: stderr || error.message,
      executionTime,
    };
  }
}

/**
 * Remove ANSI escape codes from text
 */
function cleanAnsiCodes(text: string): string {
  return text
    .replace(/\x1b\[[0-9;]*m/g, '') // Remove color codes
    .replace(/\x1b\[[0-9;]*[A-Za-z]/g, '') // Remove other escape sequences
    .split('\n')
    .filter(line => {
      const trimmed = line.trim();
      // Filter out metadata lines
      if (!trimmed) return false;
      if (trimmed.startsWith('>')) return false;
      if (trimmed.includes('·') && trimmed.includes('claude')) return false;
      return true;
    })
    .join('\n')
    .trim();
}



/**
 * Build the prompt with conversation history
 */
function buildPrompt(prompt: string, conversationHistory?: string): string {
  if (!conversationHistory) {
    return prompt;
  }

  return `Previous conversation context:
${conversationHistory}

Current request:
${prompt}`;
}

/**
 * Get the default AGENTS.md template for a new group, dynamically loading skills.
 */
function getDefaultAgentsTemplate(groupId: string): string {
  let skillsSection = '';
  try {
    const skillsDir = path.resolve(process.cwd(), 'skills');
    if (fs.existsSync(skillsDir)) {
      const files = fs.readdirSync(skillsDir).filter(f => f.endsWith('.md') || f.endsWith('.txt'));
      if (files.length > 0) {
        skillsSection = '\\n## Available Skills (Loaded from /skills)\\n\\n';
        for (const file of files) {
          const content = fs.readFileSync(path.join(skillsDir, file), 'utf8');
          const skillName = path.parse(file).name;
          skillsSection += `### Skill: [${skillName}]\\n${content}\\n\\n`;
        }
      }
    }
  } catch (error) {
    console.error('Error loading skills for AGENTS.md:', error);
  }

  return `# NanoCode Agent Instructions

This is the memory file for group: ${groupId}

## About You

You are a helpful AI assistant running via NanoCode. You can:
- Answer questions
- Help with tasks
- Remember context from this conversation
- Execute commands in your workspace

## Guidelines

- Be concise and helpful
- Ask clarifying questions when needed
- Remember important information from our conversations
- Update this file with important context to remember
- Use your Subagents (Task tools) when you need to research complex problems
${skillsSection}
## Notes

<!-- Add important notes about this group/user here -->
`;
}

/**
 * Get active containers for this group
 */
export async function getActiveContainers(groupId: string): Promise<string[]> {
  return new Promise((resolve) => {
    const proc = spawn('docker', ['ps', '--filter', `name=nanocode-${groupId}`, '--format', '{{.Names}}'], {
      stdio: 'pipe',
    });

    let output = '';
    proc.stdout?.on('data', (data) => {
      output += data.toString();
    });

    proc.on('close', () => {
      const containers = output.trim().split('\n').filter(Boolean);
      resolve(containers);
    });

    proc.on('error', () => resolve([]));
  });
}

/**
 * Kill all containers for a group
 */
export async function killGroupContainers(groupId: string): Promise<void> {
  const containers = await getActiveContainers(groupId);
  
  for (const container of containers) {
    spawn('docker', ['kill', container], { stdio: 'ignore' });
  }
}
