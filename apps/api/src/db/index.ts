import Database from 'better-sqlite3';
import { dirname } from 'node:path';
import { mkdirSync } from 'node:fs';
import type { EntryName } from '@ipcheck/shared';

export type Db = Database.Database;

export interface SnapshotEntryInput {
  entryName: EntryName;
  connectionCount: number;
}

export interface SnapshotTopIpInput {
  ip: string;
  connectionCount: number;
  entryBreakdown: Record<EntryName, number>;
  rank: number;
}

export interface SnapshotInput {
  createdAt: string;
  windowMinutes: number;
  totalConnections: number;
  uniqueIps: number;
  status: 'ok' | 'warning' | 'error';
  message: string;
  rawSummary: unknown;
  entries: SnapshotEntryInput[];
  topIps: SnapshotTopIpInput[];
}

export interface SnapshotRecord {
  id: number;
  createdAt: string;
  windowMinutes: number;
  totalConnections: number;
  uniqueIps: number;
  status: 'ok' | 'warning' | 'error';
  message: string;
  rawSummary: unknown;
  entries: SnapshotEntryInput[];
  topIps: SnapshotTopIpInput[];
}

interface SnapshotRow {
  id: number;
  created_at: string;
  window_minutes: number;
  total_connections: number;
  unique_ips: number;
  status: 'ok' | 'warning' | 'error';
  message: string;
  raw_summary_json: string;
}

interface EntryRow {
  entry_name: EntryName;
  connection_count: number;
}

interface TopIpRow {
  ip: string;
  connection_count: number;
  entry_breakdown_json: string;
  rank: number;
}

export function createDatabase(path: string): Db {
  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true });
  }

  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  initializeSchema(db);
  return db;
}

export function initializeSchema(db: Db): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL,
      window_minutes INTEGER NOT NULL,
      total_connections INTEGER NOT NULL,
      unique_ips INTEGER NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('ok', 'warning', 'error')),
      message TEXT NOT NULL,
      raw_summary_json TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_snapshots_created_at ON snapshots(created_at);
    CREATE INDEX IF NOT EXISTS idx_snapshots_window_created ON snapshots(window_minutes, created_at);

    CREATE TABLE IF NOT EXISTS snapshot_entry_counts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      snapshot_id INTEGER NOT NULL REFERENCES snapshots(id) ON DELETE CASCADE,
      entry_name TEXT NOT NULL CHECK (entry_name IN ('ws', 'ws1', 'ws2', 'ws3')),
      connection_count INTEGER NOT NULL,
      UNIQUE(snapshot_id, entry_name)
    );

    CREATE INDEX IF NOT EXISTS idx_snapshot_entry_counts_snapshot ON snapshot_entry_counts(snapshot_id);

    CREATE TABLE IF NOT EXISTS snapshot_top_ips (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      snapshot_id INTEGER NOT NULL REFERENCES snapshots(id) ON DELETE CASCADE,
      ip TEXT NOT NULL,
      connection_count INTEGER NOT NULL,
      entry_breakdown_json TEXT NOT NULL,
      rank INTEGER NOT NULL,
      UNIQUE(snapshot_id, rank)
    );

    CREATE INDEX IF NOT EXISTS idx_snapshot_top_ips_snapshot ON snapshot_top_ips(snapshot_id);
    CREATE INDEX IF NOT EXISTS idx_snapshot_top_ips_ip ON snapshot_top_ips(ip);

    CREATE TABLE IF NOT EXISTS collection_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      status TEXT NOT NULL CHECK (status IN ('running', 'ok', 'error')),
      logs_read INTEGER NOT NULL DEFAULT 0,
      lines_scanned INTEGER NOT NULL DEFAULT 0,
      connections_matched INTEGER NOT NULL DEFAULT 0,
      error_message TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_collection_runs_started_at ON collection_runs(started_at);
  `);
}

export function insertSnapshot(db: Db, snapshot: SnapshotInput): number {
  const transaction = db.transaction((input: SnapshotInput) => {
    const result = db
      .prepare(`
        INSERT INTO snapshots (
          created_at,
          window_minutes,
          total_connections,
          unique_ips,
          status,
          message,
          raw_summary_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        input.createdAt,
        input.windowMinutes,
        input.totalConnections,
        input.uniqueIps,
        input.status,
        input.message,
        JSON.stringify(input.rawSummary),
      );

    const snapshotId = Number(result.lastInsertRowid);

    const insertEntry = db.prepare(`
      INSERT INTO snapshot_entry_counts (snapshot_id, entry_name, connection_count)
      VALUES (?, ?, ?)
    `);

    for (const entry of input.entries) {
      insertEntry.run(snapshotId, entry.entryName, entry.connectionCount);
    }

    const insertTopIp = db.prepare(`
      INSERT INTO snapshot_top_ips (snapshot_id, ip, connection_count, entry_breakdown_json, rank)
      VALUES (?, ?, ?, ?, ?)
    `);

    for (const item of input.topIps) {
      insertTopIp.run(
        snapshotId,
        item.ip,
        item.connectionCount,
        JSON.stringify(item.entryBreakdown),
        item.rank,
      );
    }

    return snapshotId;
  });

  return transaction(snapshot);
}

export function getLatestSnapshot(db: Db): SnapshotRecord | null {
  const row = db
    .prepare('SELECT * FROM snapshots ORDER BY created_at DESC, id DESC LIMIT 1')
    .get() as SnapshotRow | undefined;

  if (!row) {
    return null;
  }

  return hydrateSnapshot(db, row);
}

export function cleanupOldSnapshots(db: Db, nowIso: string, retentionDays: number): number {
  const cutoff = new Date(nowIso);
  cutoff.setUTCDate(cutoff.getUTCDate() - retentionDays);

  const result = db
    .prepare('DELETE FROM snapshots WHERE created_at < ?')
    .run(cutoff.toISOString());

  return result.changes;
}

function hydrateSnapshot(db: Db, row: SnapshotRow): SnapshotRecord {
  const entries = db
    .prepare(`
      SELECT entry_name, connection_count
      FROM snapshot_entry_counts
      WHERE snapshot_id = ?
      ORDER BY entry_name ASC
    `)
    .all(row.id) as EntryRow[];

  const topIps = db
    .prepare(`
      SELECT ip, connection_count, entry_breakdown_json, rank
      FROM snapshot_top_ips
      WHERE snapshot_id = ?
      ORDER BY rank ASC
    `)
    .all(row.id) as TopIpRow[];

  return {
    id: row.id,
    createdAt: row.created_at,
    windowMinutes: row.window_minutes,
    totalConnections: row.total_connections,
    uniqueIps: row.unique_ips,
    status: row.status,
    message: row.message,
    rawSummary: JSON.parse(row.raw_summary_json),
    entries: entries.map((entry) => ({
      entryName: entry.entry_name,
      connectionCount: entry.connection_count,
    })),
    topIps: topIps.map((item) => ({
      ip: item.ip,
      connectionCount: item.connection_count,
      entryBreakdown: JSON.parse(item.entry_breakdown_json) as Record<EntryName, number>,
      rank: item.rank,
    })),
  };
}
