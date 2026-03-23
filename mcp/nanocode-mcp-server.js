#!/usr/bin/env node
/**
 * NanoCode MCP Server
 * Single MCP server that exposes all tools as resources/tools
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS_DIR = path.join(__dirname, '..', 'scripts');
const SKILLS_DIR = path.join(__dirname, '..', 'skills');

// Tool definitions - each tool calls a bash script
const TOOLS = [
  // Gmail tools
  {
    name: 'gmail_search',
    description: 'Search emails in Gmail. Args: query (string), maxResults (number, optional)',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Gmail search query' },
        maxResults: { type: 'number', description: 'Max results (default: 5)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'gmail_read',
    description: 'Read a specific email by message ID. Args: messageId (string)',
    inputSchema: {
      type: 'object',
      properties: {
        messageId: { type: 'string', description: 'The message ID from gmail_search' },
      },
      required: ['messageId'],
    },
  },
  {
    name: 'gmail_send',
    description: 'Send an email. Args: to (string), subject (string), body (string)',
    inputSchema: {
      type: 'object',
      properties: {
        to: { type: 'string', description: 'Recipient email' },
        subject: { type: 'string', description: 'Email subject' },
        body: { type: 'string', description: 'Email body' },
      },
      required: ['to', 'subject', 'body'],
    },
  },

  // Calendar tools
  {
    name: 'calendar_list',
    description: 'List calendar events. Args: timeMin (string, optional), timeMax (string, optional), maxResults (number, optional)',
    inputSchema: {
      type: 'object',
      properties: {
        timeMin: { type: 'string', description: 'Start date (ISO format)' },
        timeMax: { type: 'string', description: 'End date (ISO format)' },
        maxResults: { type: 'number', description: 'Max results (default: 10)' },
      },
    },
  },
  {
    name: 'calendar_create',
    description: 'Create a calendar event. Args: title (string), start (string), end (string), attendees (string, optional)',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Event title' },
        start: { type: 'string', description: 'Start datetime (YYYY-MM-DD or YYYY-MM-DDTHH:MM:SS)' },
        end: { type: 'string', description: 'End datetime (YYYY-MM-DD or YYYY-MM-DDTHH:MM:SS)' },
        attendees: { type: 'string', description: 'Comma-separated email addresses' },
      },
      required: ['title', 'start', 'end'],
    },
  },

  // Drive tools
  {
    name: 'drive_list',
    description: 'List files in Google Drive. Args: folderId (string, optional), maxResults (number, optional)',
    inputSchema: {
      type: 'object',
      properties: {
        folderId: { type: 'string', description: 'Folder ID (root if not specified)' },
        maxResults: { type: 'number', description: 'Max results (default: 20)' },
      },
    },
  },
  {
    name: 'drive_search',
    description: 'Search files in Google Drive by name. Args: name (string), maxResults (number, optional)',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'File name to search' },
        maxResults: { type: 'number', description: 'Max results (default: 20)' },
      },
      required: ['name'],
    },
  },
  {
    name: 'drive_read',
    description: 'Read/export a file from Google Drive. Args: fileId (string), format (string, optional)',
    inputSchema: {
      type: 'object',
      properties: {
        fileId: { type: 'string', description: 'File ID' },
        format: { type: 'string', description: 'Export format: txt, pdf, csv, html' },
      },
      required: ['fileId'],
    },
  },
  {
    name: 'drive_download',
    description: 'Download a file from Google Drive to a local path. Args: fileId (string), outputPath (string)',
    inputSchema: {
      type: 'object',
      properties: {
        fileId: { type: 'string', description: 'File ID' },
        outputPath: { type: 'string', description: 'Absolute output path in the runtime environment' },
      },
      required: ['fileId', 'outputPath'],
    },
  },
  {
    name: 'drive_upload',
    description: 'Upload a local file to Google Drive. Args: localPath (string), fileName (string, optional), folderId (string, optional), mimeType (string, optional)',
    inputSchema: {
      type: 'object',
      properties: {
        localPath: { type: 'string', description: 'Absolute local file path to upload' },
        fileName: { type: 'string', description: 'Target file name in Drive' },
        folderId: { type: 'string', description: 'Target Drive folder ID' },
        mimeType: { type: 'string', description: 'Optional mime type override' },
      },
      required: ['localPath'],
    },
  },


  // Sheets tools
  {
    name: 'sheets_list',
    description: 'List Google Sheets files. Args: maxResults (number, optional)',
    inputSchema: {
      type: 'object',
      properties: {
        maxResults: { type: 'number', description: 'Max results (default: 20)' },
      },
    },
  },
  {
    name: 'sheets_read',
    description: 'Read values from a Google Sheet. Args: spreadsheetId (string), sheetName (string, optional), range (string, optional)',
    inputSchema: {
      type: 'object',
      properties: {
        spreadsheetId: { type: 'string', description: 'Spreadsheet ID' },
        sheetName: { type: 'string', description: 'Sheet name/tab' },
        range: { type: 'string', description: 'A1 range within the sheet (for example A1:C20)' },
      },
      required: ['spreadsheetId'],
    },
  },
  {
    name: 'sheets_update',
    description: 'Update values in a Google Sheet range. Args: spreadsheetId (string), range (string), values (string[] rows, comma-separated per row)',
    inputSchema: {
      type: 'object',
      properties: {
        spreadsheetId: { type: 'string', description: 'Spreadsheet ID' },
        range: { type: 'string', description: 'A1 range (for example Sheet1!A1:C3)' },
        values: {
          type: 'array',
          description: 'Rows to write. Each item is one comma-separated row, e.g. ["Name,Age", "Alice,30"]',
          items: { type: 'string' },
        },
      },
      required: ['spreadsheetId', 'range', 'values'],
    },
  },

  // Google Docs tools
  {
    name: 'docs_list',
    description: 'List Google Docs documents. Args: maxResults (number, optional)',
    inputSchema: {
      type: 'object',
      properties: {
        maxResults: { type: 'number', description: 'Max results (default: 20)' },
      },
    },
  },
  {
    name: 'docs_read',
    description: 'Read a Google Docs document by ID. Args: documentId (string)',
    inputSchema: {
      type: 'object',
      properties: {
        documentId: { type: 'string', description: 'Google Docs document ID' },
      },
      required: ['documentId'],
    },
  },
  {
    name: 'docs_create',
    description: 'Create a Google Docs document. Args: title (string), content (string, optional)',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Document title' },
        content: { type: 'string', description: 'Optional initial content' },
      },
      required: ['title'],
    },
  },

  // Additional Calendar tools
  {
    name: 'calendar_get',
    description: 'Get full details for a Google Calendar event. Args: eventId (string)',
    inputSchema: {
      type: 'object',
      properties: {
        eventId: { type: 'string', description: 'Calendar event ID' },
      },
      required: ['eventId'],
    },
  },
  {
    name: 'calendar_delete',
    description: 'Delete a Google Calendar event. Args: eventId (string)',
    inputSchema: {
      type: 'object',
      properties: {
        eventId: { type: 'string', description: 'Calendar event ID' },
      },
      required: ['eventId'],
    },
  },

  // Additional Drive tools
  {
    name: 'drive_create_folder',
    description: 'Create a folder in Google Drive. Args: name (string), parentFolderId (string, optional)',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Folder name' },
        parentFolderId: { type: 'string', description: 'Optional parent folder ID' },
      },
      required: ['name'],
    },
  },
  {
    name: 'drive_share',
    description: 'Share a Google Drive file with a user. Args: fileId (string), email (string), role (string, optional: reader|commenter|writer)',
    inputSchema: {
      type: 'object',
      properties: {
        fileId: { type: 'string', description: 'Drive file ID' },
        email: { type: 'string', description: 'Email address to share with' },
        role: { type: 'string', description: 'Permission role: reader, commenter, or writer' },
      },
      required: ['fileId', 'email'],
    },
  },

  // ClickUp tools
  {
    name: 'clickup_get_tasks',
    description: 'Get tasks from ClickUp. Args: listId (string), includeClosed (boolean, optional)',
    inputSchema: {
      type: 'object',
      properties: {
        listId: { type: 'string', description: 'ClickUp list ID' },
        includeClosed: { type: 'boolean', description: 'Include closed tasks (default: false)' },
      },
      required: ['listId'],
    },
  },
  {
    name: 'clickup_get_team_tasks',
    description: 'Get tasks from a ClickUp team. Args: teamId (string), spaceId (string, optional), includeClosed (boolean, optional)',
    inputSchema: {
      type: 'object',
      properties: {
        teamId: { type: 'string', description: 'ClickUp team ID' },
        spaceId: { type: 'string', description: 'Optional space ID filter' },
        includeClosed: { type: 'boolean', description: 'Include closed tasks (default: false)' },
      },
      required: ['teamId'],
    },
  },
  {
    name: 'clickup_create_task',
    description: 'Create a task in ClickUp. Args: listId (string), name (string), dueDate (number, optional)',
    inputSchema: {
      type: 'object',
      properties: {
        listId: { type: 'string', description: 'ClickUp list ID' },
        name: { type: 'string', description: 'Task name' },
        dueDate: { type: 'number', description: 'Due date timestamp (ms)' },
      },
      required: ['listId', 'name'],
    },
  },
  {
    name: 'clickup_add_checklist_item',
    description: 'Add item to a checklist. Args: checklistId (string), name (string), dueDate (number, optional)',
    inputSchema: {
      type: 'object',
      properties: {
        checklistId: { type: 'string', description: 'ClickUp checklist ID' },
        name: { type: 'string', description: 'Item name' },
        dueDate: { type: 'number', description: 'Due date timestamp (ms)' },
      },
      required: ['checklistId', 'name'],
    },
  },
  {
    name: 'clickup_get_checklists',
    description: 'Get checklists from a task. Args: taskId (string)',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: 'ClickUp task ID' },
      },
      required: ['taskId'],
    },
  },

  // Contacts tools
  {
    name: 'contacts_list',
    description: 'List Google Contacts. Args: maxResults (number, optional)',
    inputSchema: {
      type: 'object',
      properties: {
        maxResults: { type: 'number', description: 'Max results (default: 50)' },
      },
    },
  },
  {
    name: 'contacts_search',
    description: 'Search Google Contacts by name. Args: query (string)',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Name to search' },
      },
      required: ['query'],
    },
  },
  {
    name: 'contacts_create',
    description: 'Create a contact in the main Google account (macad.macacus@gmail.com). Args: name (string), email/phone/organization/title/city/notes (optional), dryRun (optional)',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Contact full name' },
        email: { type: 'string', description: 'Primary email' },
        phone: { type: 'string', description: 'Primary phone' },
        organization: { type: 'string', description: 'Company/organization name' },
        title: { type: 'string', description: 'Job title or role' },
        city: { type: 'string', description: 'City' },
        notes: { type: 'string', description: 'Short notes/context' },
        dryRun: { type: 'boolean', description: 'If true, does not create and only shows payload' },
      },
      required: ['name'],
    },
  },
  {
    name: 'contacts_upsert',
    description: 'Create or update a contact in the main Google account. If contact exists by name/email/phone, updates it; otherwise creates it. Args: name plus optional fields.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Contact full name' },
        email: { type: 'string', description: 'Primary email' },
        phone: { type: 'string', description: 'Primary phone' },
        organization: { type: 'string', description: 'Company/organization name' },
        title: { type: 'string', description: 'Job title or role' },
        city: { type: 'string', description: 'City' },
        notes: { type: 'string', description: 'Short notes/context' },
        dryRun: { type: 'boolean', description: 'If true, does not write and only previews action' },
      },
      required: ['name'],
    },
  },
  {
    name: 'contacts_delete',
    description: 'Delete a contact in the main Google account by exact query or resourceName. Args: query (string), dryRun (optional).',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Contact name/email/phone or resourceName (people/...)' },
        dryRun: { type: 'boolean', description: 'If true, preview deletion target without deleting' },
      },
      required: ['query'],
    },
  },
  {
    name: 'contacts_list_personal',
    description: 'List personal Google Contacts (read-only account). Args: maxResults (number, optional)',
    inputSchema: {
      type: 'object',
      properties: {
        maxResults: { type: 'number', description: 'Max results (default: 50)' },
      },
    },
  },
  {
    name: 'contacts_search_personal',
    description: 'Search personal Google Contacts by name (read-only account). Args: query (string)',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Name to search' },
      },
      required: ['query'],
    },
  },

  // Persianas tools
  {
    name: 'persianas_subir',
    description: 'Open blinds (persianas) via Tuya IoT',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'persianas_bajar',
    description: 'Close blinds (persianas) via Tuya IoT',
    inputSchema: { type: 'object', properties: {} },
  },
];

/**
 * Execute a bash script and return its output
 */
async function executeScript(scriptName, args = []) {
  return new Promise((resolve, reject) => {
    const primaryPath = path.join(SCRIPTS_DIR, `${scriptName}.sh`);
    const fallbackPath = path.join(SKILLS_DIR, `${scriptName}.sh`);
    const scriptPath = fs.existsSync(primaryPath) ? primaryPath : fallbackPath;

    if (!fs.existsSync(scriptPath)) {
      reject(new Error(`Script not found: ${scriptName}.sh (checked ${primaryPath} and ${fallbackPath})`));
      return;
    }

    const child = spawn('bash', [scriptPath, ...args], {
      env: { ...process.env },
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve(stdout.trim());
      } else {
        reject(new Error(`Script failed with code ${code}: ${stderr || stdout}`));
      }
    });

    child.on('error', reject);
  });
}

/**
 * Map tool names to script names and arguments
 */
function toolToScript(toolName, args) {
  switch (toolName) {
    case 'gmail_search':
      return { script: 'gmail_search', args: [args.query, args.maxResults].filter(Boolean) };
    case 'gmail_read':
      return { script: 'gmail_read', args: [args.messageId] };
    case 'gmail_send':
      return { script: 'gmail_send', args: [args.to, args.subject, args.body] };
    case 'calendar_list':
      return { script: 'calendar_list', args: [args.timeMin, args.timeMax, args.maxResults].filter(Boolean) };
    case 'calendar_create':
      return { script: 'calendar_create', args: [args.title, args.start, args.end, args.attendees].filter(Boolean) };
    case 'drive_list':
      return { script: 'drive_list', args: [args.folderId, args.maxResults].filter(Boolean) };
    case 'drive_search':
      return { script: 'drive_search', args: [args.name, args.maxResults].filter(Boolean) };
    case 'drive_read':
      return { script: 'drive_read', args: [args.fileId, args.format].filter(Boolean) };
    case 'drive_download':
      return { script: 'drive_download', args: [args.fileId, args.outputPath] };
    case 'drive_upload':
      return { script: 'drive_upload', args: [args.localPath, args.fileName, args.folderId, args.mimeType].filter(Boolean) };

    case 'sheets_list':
      return { script: 'sheets_list', args: [args.maxResults].filter(Boolean) };
    case 'sheets_read':
      return { script: 'sheets_read', args: [args.spreadsheetId, args.sheetName, args.range].filter((v) => v !== undefined) };
    case 'sheets_update': {
      const rows = Array.isArray(args.values) ? args.values : [];
      return { script: 'sheets_update', args: [args.spreadsheetId, args.range, ...rows] };
    }
    case 'docs_list':
      return { script: 'docs_list', args: [args.maxResults].filter(Boolean) };
    case 'docs_read':
      return { script: 'docs_read', args: [args.documentId] };
    case 'docs_create':
      return { script: 'docs_create', args: [args.title, args.content].filter((v) => v !== undefined) };
    case 'calendar_get':
      return { script: 'calendar_get', args: [args.eventId] };
    case 'calendar_delete':
      return { script: 'calendar_delete', args: [args.eventId] };
    case 'drive_create_folder':
      return { script: 'drive_create_folder', args: [args.name, args.parentFolderId].filter((v) => v !== undefined) };
    case 'drive_share':
      return { script: 'drive_share', args: [args.fileId, args.email, args.role].filter((v) => v !== undefined) };
    case 'contacts_list':
      return { script: 'contacts_list', args: [args.maxResults].filter(Boolean) };
    case 'contacts_search':
      return { script: 'contacts_search', args: [args.query] };
    case 'contacts_create':
      return {
        script: 'contacts_create',
        args: [
          args.name,
          args.email,
          args.phone,
          args.organization,
          args.title,
          args.city,
          args.notes,
          String(Boolean(args.dryRun)),
        ].filter((v) => v !== undefined),
      };
    case 'contacts_upsert':
      return {
        script: 'contacts_upsert',
        args: [
          args.name,
          args.email,
          args.phone,
          args.organization,
          args.title,
          args.city,
          args.notes,
          String(Boolean(args.dryRun)),
        ].filter((v) => v !== undefined),
      };
    case 'contacts_delete':
      return {
        script: 'contacts_delete',
        args: [args.query, String(Boolean(args.dryRun))].filter((v) => v !== undefined),
      };
    case 'contacts_list_personal':
      return { script: 'contacts_personal_list', args: [args.maxResults].filter(Boolean) };
    case 'contacts_search_personal':
      return { script: 'contacts_personal_search', args: [args.query] };
    case 'persianas_subir':
      return { script: 'persianas/subir', args: [] };
    case 'persianas_bajar':
      return { script: 'persianas/bajar', args: [] };
    case 'clickup_get_tasks':
      return { script: 'clickup_tasks', args: ['list', args.listId, args.includeClosed ? 'true' : 'false'] };
    case 'clickup_get_team_tasks':
      return {
        script: 'clickup_tasks',
        args: ['team', args.teamId, args.spaceId || '', args.includeClosed ? 'true' : 'false'],
      };
    case 'clickup_create_task':
      return { script: 'clickup_tasks', args: ['create', args.listId, args.name, args.dueDate].filter(Boolean) };
    case 'clickup_add_checklist_item':
      return { script: 'clickup_checklist', args: ['add', args.checklistId, args.name, args.dueDate].filter(Boolean) };
    case 'clickup_get_checklists':
      return { script: 'clickup_checklist', args: ['get', args.taskId] };
    default:
      throw new Error(`Unknown tool: ${toolName}`);
  }
}

// Create MCP server
const server = new Server(
  {
    name: 'nanocode-mcp',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// List tools handler
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: TOOLS,
  };
});

// Call tool handler
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    const { script, args: scriptArgs } = toolToScript(name, args);
    const output = await executeScript(script, scriptArgs);

    return {
      content: [
        {
          type: 'text',
          text: output,
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: `Error: ${error.message}`,
        },
      ],
      isError: true,
    };
  }
});

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('NanoCode MCP Server started');
}

main().catch(console.error);
