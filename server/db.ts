import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const DATA_DIR = path.resolve(process.env.DATA_DIR?.trim() || path.join(process.cwd(), 'data'));
export const DOWNLOADS_DIR = path.resolve(DATA_DIR, 'downloads');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
if (!fs.existsSync(DOWNLOADS_DIR)) {
  fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
}

const DB_PATH = path.join(DATA_DIR, 'hamilha.db');
export const db = new DatabaseSync(DB_PATH);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS downloads (
    id TEXT PRIMARY KEY,
    url TEXT NOT NULL,
    platform TEXT NOT NULL,
    title TEXT NOT NULL,
    author TEXT NOT NULL,
    thumbnail_url TEXT,
    media_type TEXT NOT NULL,
    quality TEXT NOT NULL,
    file_size TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'app',
    client_id TEXT NOT NULL DEFAULT 'anonymous',
    status TEXT NOT NULL DEFAULT 'completed',
    stream_mode TEXT NOT NULL DEFAULT 'direct',
    local_file_path TEXT,
    mime_type TEXT,
    file_bytes INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS request_logs (
    id TEXT PRIMARY KEY,
    endpoint TEXT NOT NULL,
    platform TEXT NOT NULL,
    url TEXT,
    client_id TEXT NOT NULL DEFAULT 'anonymous',
    source TEXT NOT NULL DEFAULT 'app',
    status TEXT NOT NULL,
    latency_ms INTEGER NOT NULL DEFAULT 0,
    error_message TEXT,
    resolved INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS whatsapp_messages (
    id TEXT PRIMARY KEY,
    wa_message_id TEXT,
    sender_phone_masked TEXT NOT NULL,
    direction TEXT NOT NULL,
    message_type TEXT NOT NULL,
    content TEXT NOT NULL,
    media_url TEXT,
    platform TEXT,
    download_id TEXT,
    status TEXT NOT NULL DEFAULT 'processed',
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS bot_config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS admin_auth (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    passcode_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    claimed_at TEXT NOT NULL
  );
`);

// Safe column migrations for pre-existing SQLite databases
const existingCols = (
  db.prepare('PRAGMA table_info(downloads)').all() as Array<{ name: string }>
).map((c) => c.name);
if (!existingCols.includes('local_file_path')) {
  db.exec('ALTER TABLE downloads ADD COLUMN local_file_path TEXT');
}
if (!existingCols.includes('mime_type')) {
  db.exec('ALTER TABLE downloads ADD COLUMN mime_type TEXT');
}
if (!existingCols.includes('file_bytes')) {
  db.exec('ALTER TABLE downloads ADD COLUMN file_bytes INTEGER NOT NULL DEFAULT 0');
}

const existingWaCols = (
  db.prepare('PRAGMA table_info(whatsapp_messages)').all() as Array<{ name: string }>
).map((c) => c.name);
if (!existingWaCols.includes('client_id')) {
  db.exec("ALTER TABLE whatsapp_messages ADD COLUMN client_id TEXT NOT NULL DEFAULT 'webhook'");
}

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_downloads_client_created ON downloads (client_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_wa_client_created ON whatsapp_messages (client_id, created_at ASC);
`);

const defaultBotConfig: Record<string, string> = {
  bot_enabled: 'true',
  auto_reply: 'true',
  accept_user_media: 'true',
  default_quality: '720p',
  max_file_mb: '150',
  welcome_message:
    'أهلاً بك في بوت حمّلها. أرسل رابط وسائط عام متاح للتنزيل، أو أرسل صورة/فيديو/مستند لحفظه.',
};

const insertConfigStmt = db.prepare(
  'INSERT OR IGNORE INTO bot_config (key, value) VALUES (?, ?)',
);
for (const [key, value] of Object.entries(defaultBotConfig)) {
  insertConfigStmt.run(key, value);
}

export function getBotConfigMap(): Record<string, string> {
  const rows = db.prepare('SELECT key, value FROM bot_config').all() as Array<{
    key: string;
    value: string;
  }>;
  const map: Record<string, string> = { ...defaultBotConfig };
  for (const row of rows) {
    map[row.key] = row.value;
  }
  return map;
}

export function setBotConfigValue(key: string, value: string): void {
  db.prepare(
    'INSERT INTO bot_config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  ).run(key, value);
}

export interface DownloadRecord {
  id: string;
  url: string;
  platform: string;
  title: string;
  author: string;
  thumbnail_url: string | null;
  media_type: string;
  quality: string;
  file_size: string;
  source: string;
  client_id: string;
  status: string;
  stream_mode: string;
  local_file_path: string | null;
  mime_type: string | null;
  file_bytes: number;
  created_at: string;
}

export function insertDownload(
  record: Omit<DownloadRecord, 'created_at'> & { id?: string },
): DownloadRecord {
  const full: DownloadRecord = {
    ...record,
    id: record.id || crypto.randomUUID(),
    created_at: new Date().toISOString(),
  };
  db.prepare(
    `INSERT INTO downloads (
      id, url, platform, title, author, thumbnail_url,
      media_type, quality, file_size, source, client_id, status, stream_mode,
      local_file_path, mime_type, file_bytes, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    full.id,
    full.url,
    full.platform,
    full.title,
    full.author,
    full.thumbnail_url,
    full.media_type,
    full.quality,
    full.file_size,
    full.source,
    full.client_id,
    full.status,
    full.stream_mode,
    full.local_file_path,
    full.mime_type,
    full.file_bytes,
    full.created_at,
  );
  return full;
}

export function listDownloadsByClient(
  clientId: string,
  limit = 30,
  platform?: string,
): DownloadRecord[] {
  if (platform && platform !== 'all') {
    return db
      .prepare(
        'SELECT * FROM downloads WHERE client_id = ? AND platform = ? ORDER BY created_at DESC LIMIT ?',
      )
      .all(clientId, platform, limit) as unknown as DownloadRecord[];
  }
  return db
    .prepare('SELECT * FROM downloads WHERE client_id = ? ORDER BY created_at DESC LIMIT ?')
    .all(clientId, limit) as unknown as DownloadRecord[];
}

export function getDownloadById(id: string): DownloadRecord | undefined {
  return db.prepare('SELECT * FROM downloads WHERE id = ?').get(id) as unknown as
    | DownloadRecord
    | undefined;
}

export function getDownloadByIdForClient(id: string, clientId: string): DownloadRecord | undefined {
  return db
    .prepare('SELECT * FROM downloads WHERE id = ? AND client_id = ?')
    .get(id, clientId) as unknown as DownloadRecord | undefined;
}

function safelyRemoveDiskFile(localPath: string | null): void {
  if (!localPath) return;
  const resolved = path.resolve(localPath);
  if (resolved.startsWith(DOWNLOADS_DIR + path.sep) && fs.existsSync(resolved)) {
    try {
      fs.unlinkSync(resolved);
    } catch {
      // Ignore file unlink failure
    }
  }
}

export function deleteDownloadByIdForClient(id: string, clientId: string): boolean {
  const rec = getDownloadByIdForClient(id, clientId);
  if (!rec) return false;
  const result = db.prepare('DELETE FROM downloads WHERE id = ? AND client_id = ?').run(id, clientId);
  if (result.changes > 0) {
    safelyRemoveDiskFile(rec.local_file_path);
  }
  return result.changes > 0;
}

export function clearDownloadsForClient(clientId: string): number {
  const rows = db
    .prepare('SELECT local_file_path FROM downloads WHERE client_id = ?')
    .all(clientId) as Array<{ local_file_path: string | null }>;
  const result = db.prepare('DELETE FROM downloads WHERE client_id = ?').run(clientId);
  for (const r of rows) {
    safelyRemoveDiskFile(r.local_file_path);
  }
  return Number(result.changes || 0);
}

export function cleanupExpiredDownloads(options: {
  ttlHours: number;
  maxStorageMb: number;
}): { removedExpired: number; removedForQuota: number; removedOrphans: number } {
  const ttlMs = Math.max(1, options.ttlHours) * 60 * 60 * 1000;
  const maxBytes = Math.max(20, options.maxStorageMb) * 1024 * 1024;
  const cutoffIso = new Date(Date.now() - ttlMs).toISOString();

  // 1. Remove expired downloads (DB + disk)
  const expiredRows = db
    .prepare('SELECT id, local_file_path FROM downloads WHERE created_at < ?')
    .all(cutoffIso) as Array<{ id: string; local_file_path: string | null }>;

  let removedExpired = 0;
  if (expiredRows.length > 0) {
    db.prepare('DELETE FROM downloads WHERE created_at < ?').run(cutoffIso);
    for (const row of expiredRows) {
      safelyRemoveDiskFile(row.local_file_path);
      removedExpired += 1;
    }
  }

  // 2. Enforce total storage quota by evicting oldest files first
  let removedForQuota = 0;
  const allRows = db
    .prepare(
      'SELECT id, local_file_path, file_bytes FROM downloads WHERE local_file_path IS NOT NULL ORDER BY created_at ASC',
    )
    .all() as Array<{ id: string; local_file_path: string | null; file_bytes: number }>;

  let totalBytes = allRows.reduce((sum, r) => sum + (Number(r.file_bytes) || 0), 0);
  for (const row of allRows) {
    if (totalBytes <= maxBytes) break;
    safelyRemoveDiskFile(row.local_file_path);
    db.prepare('UPDATE downloads SET local_file_path = NULL, file_bytes = 0 WHERE id = ?').run(
      row.id,
    );
    totalBytes -= Number(row.file_bytes) || 0;
    removedForQuota += 1;
  }

  // 3. Remove orphaned files on disk not referenced by any download record
  let removedOrphans = 0;
  try {
    const referencedPaths = new Set(
      (
        db
          .prepare('SELECT local_file_path FROM downloads WHERE local_file_path IS NOT NULL')
          .all() as Array<{ local_file_path: string }>
      ).map((r) => path.resolve(r.local_file_path)),
    );
    const diskEntries = fs.readdirSync(DOWNLOADS_DIR);
    const orphanGraceCutoff = Date.now() - 10 * 60 * 1000; // skip files currently being written
    for (const name of diskEntries) {
      const fullPath = path.resolve(DOWNLOADS_DIR, name);
      if (!fullPath.startsWith(DOWNLOADS_DIR + path.sep)) continue;
      if (referencedPaths.has(fullPath)) continue;
      try {
        const stat = fs.statSync(fullPath);
        if (stat.isFile() && stat.mtimeMs < orphanGraceCutoff) {
          fs.unlinkSync(fullPath);
          removedOrphans += 1;
        }
      } catch {
        // Ignore single file error
      }
    }
  } catch {
    // Ignore directory read error
  }

  return { removedExpired, removedForQuota, removedOrphans };
}

export function logRequest(entry: {
  endpoint: string;
  platform: string;
  url?: string;
  clientId?: string;
  source?: string;
  status: 'success' | 'error' | 'blocked';
  latencyMs: number;
  errorMessage?: string;
}): void {
  db.prepare(
    `INSERT INTO request_logs (
      id, endpoint, platform, url, client_id, source, status, latency_ms, error_message, resolved, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
  ).run(
    crypto.randomUUID(),
    entry.endpoint,
    entry.platform,
    entry.url ?? null,
    entry.clientId ?? 'anonymous',
    entry.source ?? 'app',
    entry.status,
    Math.max(0, Math.round(entry.latencyMs)),
    entry.errorMessage ?? null,
    new Date().toISOString(),
  );
}

export interface WhatsAppMessageRecord {
  id: string;
  wa_message_id: string | null;
  sender_phone_masked: string;
  direction: 'inbound' | 'outbound';
  message_type: string;
  content: string;
  media_url: string | null;
  platform: string | null;
  download_id: string | null;
  status: string;
  client_id: string;
  created_at: string;
}

export function insertWhatsAppMessage(
  msg: Omit<WhatsAppMessageRecord, 'id' | 'created_at' | 'client_id'> & { client_id?: string },
): WhatsAppMessageRecord {
  const full: WhatsAppMessageRecord = {
    ...msg,
    client_id: msg.client_id || 'webhook',
    id: crypto.randomUUID(),
    created_at: new Date().toISOString(),
  };
  db.prepare(
    `INSERT INTO whatsapp_messages (
      id, wa_message_id, sender_phone_masked, direction, message_type,
      content, media_url, platform, download_id, status, client_id, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    full.id,
    full.wa_message_id,
    full.sender_phone_masked,
    full.direction,
    full.message_type,
    full.content,
    full.media_url,
    full.platform,
    full.download_id,
    full.status,
    full.client_id,
    full.created_at,
  );
  return full;
}

export function listWhatsAppMessagesByClient(clientId: string, limit = 50): WhatsAppMessageRecord[] {
  return db
    .prepare(
      'SELECT * FROM whatsapp_messages WHERE client_id = ? ORDER BY created_at ASC LIMIT ?',
    )
    .all(clientId, limit) as unknown as WhatsAppMessageRecord[];
}
