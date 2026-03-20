import Database from 'better-sqlite3';
import { nanoid } from 'nanoid';
import path from 'path';
import fs from 'fs';
import type { Message, Group, Task, Session } from './types.js';

const DB_PATH = path.join(process.cwd(), 'data', 'nanocode.db');

let db: Database.Database | null = null;

/**
 * Initialize the database connection and create tables if they don't exist.
 */
export function initDatabase(): Database.Database {
  if (db) return db;

  // Ensure data directory exists
  const dataDir = path.dirname(DB_PATH);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Create tables
  db.exec(`
    -- Groups table
    CREATE TABLE IF NOT EXISTS groups (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      channel_type TEXT NOT NULL,
      channel_group_id TEXT NOT NULL,
      is_main INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      metadata TEXT,
      UNIQUE(channel_type, channel_group_id)
    );

    -- Messages table
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      group_id TEXT NOT NULL,
      channel_type TEXT NOT NULL,
      sender_id TEXT NOT NULL,
      sender_name TEXT NOT NULL,
      content TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      is_from_bot INTEGER DEFAULT 0,
      metadata TEXT,
      FOREIGN KEY (group_id) REFERENCES groups(id)
    );

    -- Tasks table (scheduled jobs)
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      group_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      cron_expression TEXT NOT NULL,
      prompt TEXT NOT NULL,
      is_enabled INTEGER DEFAULT 1,
      last_run_at INTEGER,
      next_run_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (group_id) REFERENCES groups(id)
    );

    -- Sessions table
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      group_id TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      last_message_at INTEGER NOT NULL,
      message_count INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      FOREIGN KEY (group_id) REFERENCES groups(id)
    );

    -- State table (key-value store for misc state)
    CREATE TABLE IF NOT EXISTS state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );

    -- Create indexes
    CREATE INDEX IF NOT EXISTS idx_messages_group_id ON messages(group_id);
    CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp);
    CREATE INDEX IF NOT EXISTS idx_tasks_group_id ON tasks(group_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_next_run ON tasks(next_run_at);
    CREATE INDEX IF NOT EXISTS idx_sessions_group_id ON sessions(group_id);
  `);

  return db;
}

/**
 * Get the database instance (throws if not initialized).
 */
export function getDb(): Database.Database {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return db;
}

// ============================================================================
// Group Operations
// ============================================================================

export function createGroup(group: Omit<Group, 'id' | 'createdAt' | 'updatedAt'>): Group {
  const database = getDb();
  const now = Date.now();
  const id = nanoid();

  const stmt = database.prepare(`
    INSERT INTO groups (id, name, channel_type, channel_group_id, is_main, created_at, updated_at, metadata)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    id,
    group.name,
    group.channelType,
    group.channelGroupId,
    group.isMain ? 1 : 0,
    now,
    now,
    group.metadata ? JSON.stringify(group.metadata) : null
  );

  return {
    id,
    ...group,
    createdAt: now,
    updatedAt: now,
  };
}

export function getGroupById(id: string): Group | null {
  const database = getDb();
  const row = database.prepare('SELECT * FROM groups WHERE id = ?').get(id) as any;
  return row ? rowToGroup(row) : null;
}

export function getGroupByChannelId(channelType: string, channelGroupId: string): Group | null {
  const database = getDb();
  const row = database
    .prepare('SELECT * FROM groups WHERE channel_type = ? AND channel_group_id = ?')
    .get(channelType, channelGroupId) as any;
  return row ? rowToGroup(row) : null;
}

export function getAllGroups(): Group[] {
  const database = getDb();
  const rows = database.prepare('SELECT * FROM groups ORDER BY created_at DESC').all() as any[];
  return rows.map(rowToGroup);
}

export function getMainGroup(channelType: string): Group | null {
  const database = getDb();
  const row = database
    .prepare('SELECT * FROM groups WHERE channel_type = ? AND is_main = 1')
    .get(channelType) as any;
  return row ? rowToGroup(row) : null;
}

function rowToGroup(row: any): Group {
  return {
    id: row.id,
    name: row.name,
    channelType: row.channel_type,
    channelGroupId: row.channel_group_id,
    isMain: row.is_main === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
  };
}

// ============================================================================
// Message Operations
// ============================================================================

export function saveMessage(message: Omit<Message, 'id'>): Message {
  const database = getDb();
  const id = nanoid();

  const stmt = database.prepare(`
    INSERT INTO messages (id, group_id, channel_type, sender_id, sender_name, content, timestamp, is_from_bot, metadata)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    id,
    message.groupId,
    message.channelType,
    message.senderId,
    message.senderName,
    message.content,
    message.timestamp,
    message.isFromBot ? 1 : 0,
    message.metadata ? JSON.stringify(message.metadata) : null
  );

  return { id, ...message };
}

export function getRecentMessages(groupId: string, limit = 50): Message[] {
  const database = getDb();
  const rows = database
    .prepare(
      'SELECT * FROM messages WHERE group_id = ? ORDER BY timestamp DESC LIMIT ?'
    )
    .all(groupId, limit) as any[];

  return rows.map(rowToMessage).reverse();
}

function rowToMessage(row: any): Message {
  return {
    id: row.id,
    groupId: row.group_id,
    channelType: row.channel_type,
    senderId: row.sender_id,
    senderName: row.sender_name,
    content: row.content,
    timestamp: row.timestamp,
    isFromBot: row.is_from_bot === 1,
    metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
  };
}

// ============================================================================
// Task Operations
// ============================================================================

export function createTask(task: Omit<Task, 'id' | 'createdAt' | 'updatedAt'>): Task {
  const database = getDb();
  const now = Date.now();
  const id = nanoid();

  const stmt = database.prepare(`
    INSERT INTO tasks (id, group_id, name, description, cron_expression, prompt, is_enabled, last_run_at, next_run_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    id,
    task.groupId,
    task.name,
    task.description,
    task.cronExpression,
    task.prompt,
    task.isEnabled ? 1 : 0,
    task.lastRunAt ?? null,
    task.nextRunAt ?? null,
    now,
    now
  );

  return {
    id,
    ...task,
    createdAt: now,
    updatedAt: now,
  };
}

export function getTasksByGroupId(groupId: string): Task[] {
  const database = getDb();
  const rows = database
    .prepare('SELECT * FROM tasks WHERE group_id = ? ORDER BY created_at DESC')
    .all(groupId) as any[];
  return rows.map(rowToTask);
}

export function getAllTasks(): Task[] {
  const database = getDb();
  const rows = database.prepare('SELECT * FROM tasks ORDER BY next_run_at ASC').all() as any[];
  return rows.map(rowToTask);
}

export function getEnabledTasks(): Task[] {
  const database = getDb();
  const rows = database
    .prepare('SELECT * FROM tasks WHERE is_enabled = 1 ORDER BY next_run_at ASC')
    .all() as any[];
  return rows.map(rowToTask);
}

export function updateTaskLastRun(taskId: string, lastRunAt: number, nextRunAt: number): void {
  const database = getDb();
  database.prepare(
    'UPDATE tasks SET last_run_at = ?, next_run_at = ?, updated_at = ? WHERE id = ?'
  ).run(lastRunAt, nextRunAt, Date.now(), taskId);
}

export function toggleTask(taskId: string, isEnabled: boolean): void {
  const database = getDb();
  database.prepare('UPDATE tasks SET is_enabled = ?, updated_at = ? WHERE id = ?').run(
    isEnabled ? 1 : 0,
    Date.now(),
    taskId
  );
}

export function deleteTask(taskId: string): void {
  const database = getDb();
  database.prepare('DELETE FROM tasks WHERE id = ?').run(taskId);
}

function rowToTask(row: any): Task {
  return {
    id: row.id,
    groupId: row.group_id,
    name: row.name,
    description: row.description,
    cronExpression: row.cron_expression,
    prompt: row.prompt,
    isEnabled: row.is_enabled === 1,
    lastRunAt: row.last_run_at ?? undefined,
    nextRunAt: row.next_run_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ============================================================================
// Session Operations
// ============================================================================

export function createSession(groupId: string): Session {
  const database = getDb();
  const now = Date.now();
  const id = nanoid();

  const stmt = database.prepare(`
    INSERT INTO sessions (id, group_id, started_at, last_message_at, message_count, is_active)
    VALUES (?, ?, ?, ?, 0, 1)
  `);

  stmt.run(id, groupId, now, now);

  return {
    id,
    groupId,
    startedAt: now,
    lastMessageAt: now,
    messageCount: 0,
    isActive: true,
  };
}

export function getActiveSession(groupId: string): Session | null {
  const database = getDb();
  const row = database
    .prepare('SELECT * FROM sessions WHERE group_id = ? AND is_active = 1 ORDER BY started_at DESC LIMIT 1')
    .get(groupId) as any;
  return row ? rowToSession(row) : null;
}

export function updateSession(sessionId: string, messageCount: number): void {
  const database = getDb();
  database.prepare(
    'UPDATE sessions SET last_message_at = ?, message_count = ? WHERE id = ?'
  ).run(Date.now(), messageCount, sessionId);
}

export function closeSession(sessionId: string): void {
  const database = getDb();
  database.prepare('UPDATE sessions SET is_active = 0 WHERE id = ?').run(sessionId);
}

function rowToSession(row: any): Session {
  return {
    id: row.id,
    groupId: row.group_id,
    startedAt: row.started_at,
    lastMessageAt: row.last_message_at,
    messageCount: row.message_count,
    isActive: row.is_active === 1,
  };
}

// ============================================================================
// State Operations (Key-Value Store)
// ============================================================================

export function getState(key: string): string | null {
  const database = getDb();
  const row = database.prepare('SELECT value FROM state WHERE key = ?').get(key) as any;
  return row?.value ?? null;
}

export function setState(key: string, value: string): void {
  const database = getDb();
  database.prepare(`
    INSERT INTO state (key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(key, value, Date.now());
}

export function deleteState(key: string): void {
  const database = getDb();
  database.prepare('DELETE FROM state WHERE key = ?').run(key);
}

// ============================================================================
// Cleanup
// ============================================================================

export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}
