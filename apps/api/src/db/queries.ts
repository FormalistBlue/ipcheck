import type { EntryName, RangeValue } from '@ipcheck/shared';
import type { Db } from './index.js';

export interface SnapshotListItem {
  id: number;
  createdAt: string;
  windowMinutes: number;
  totalConnections: number;
  uniqueIps: number;
  status: 'ok' | 'warning' | 'error';
  message: string;
  entries: Record<EntryName, number>;
  topIps: TopIpQueryItem[];
}

export interface TopIpQueryItem {
  ip: string;
  connectionCount: number;
  entryBreakdown: Record<EntryName, number>;
  rank: number;
}

export interface RunListItem {
  id: number;
  startedAt: string;
  finishedAt: string | null;
  status: 'running' | 'ok' | 'error';
  logsRead: number;
  linesScanned: number;
  connectionsMatched: number;
  errorMessage: string | null;
}

interface SnapshotRow {
  id: number;
  created_at: string;
  window_minutes: number;
  total_connections: number;
  unique_ips: number;
  status: 'ok' | 'warning' | 'error';
  message: string;
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

interface RunRow {
  id: number;
  started_at: string;
  finished_at: string | null;
  status: 'running' | 'ok' | 'error';
  logs_read: number;
  lines_scanned: number;
  connections_matched: number;
  error_message: string | null;
}

export function getLatestSnapshotForWindow(db: Db, windowMinutes: number): SnapshotListItem | null {
  const row = db
    .prepare('SELECT * FROM snapshots WHERE window_minutes = ? ORDER BY created_at DESC, id DESC LIMIT 1')
    .get(windowMinutes) as SnapshotRow | undefined;
  return row ? hydrateSnapshot(db, row) : null;
}

export function listRecentSnapshots(db: Db, limit: number, windowMinutes?: number): SnapshotListItem[] {
  const rows = windowMinutes
    ? (db
        .prepare('SELECT * FROM snapshots WHERE window_minutes = ? ORDER BY created_at DESC, id DESC LIMIT ?')
        .all(windowMinutes, limit) as SnapshotRow[])
    : (db
        .prepare('SELECT * FROM snapshots ORDER BY created_at DESC, id DESC LIMIT ?')
        .all(limit) as SnapshotRow[]);
  return rows.map((row) => hydrateSnapshot(db, row));
}

export function listSnapshotsForWindow(db: Db, windowMinutes: number, sinceIso?: string): SnapshotListItem[] {
  const rows = sinceIso
    ? (db
        .prepare('SELECT * FROM snapshots WHERE window_minutes = ? AND created_at >= ? ORDER BY created_at ASC, id ASC')
        .all(windowMinutes, sinceIso) as SnapshotRow[])
    : (db
        .prepare('SELECT * FROM snapshots WHERE window_minutes = ? ORDER BY created_at ASC, id ASC')
        .all(windowMinutes) as SnapshotRow[]);
  return rows.map((row) => hydrateSnapshot(db, row));
}

export function listTopIpsForWindow(db: Db, windowMinutes: number, limit: number): TopIpQueryItem[] {
  const latest = getLatestSnapshotForWindow(db, windowMinutes);
  return latest?.topIps.slice(0, limit) ?? [];
}

export function listRecentRuns(db: Db, limit: number): RunListItem[] {
  const rows = db
    .prepare('SELECT * FROM collection_runs ORDER BY started_at DESC, id DESC LIMIT ?')
    .all(limit) as RunRow[];

  return rows.map((row) => ({
    id: row.id,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    status: row.status,
    logsRead: row.logs_read,
    linesScanned: row.lines_scanned,
    connectionsMatched: row.connections_matched,
    errorMessage: row.error_message,
  }));
}

function hydrateSnapshot(db: Db, row: SnapshotRow): SnapshotListItem {
  return {
    id: row.id,
    createdAt: row.created_at,
    windowMinutes: row.window_minutes,
    totalConnections: row.total_connections,
    uniqueIps: row.unique_ips,
    status: row.status,
    message: row.message,
    entries: getEntryRecord(db, row.id),
    topIps: getTopIps(db, row.id),
  };
}

function getEntryRecord(db: Db, snapshotId: number): Record<EntryName, number> {
  const entries: Record<EntryName, number> = { ws: 0, ws1: 0, ws2: 0, ws3: 0 };
  const rows = db
    .prepare('SELECT entry_name, connection_count FROM snapshot_entry_counts WHERE snapshot_id = ?')
    .all(snapshotId) as EntryRow[];

  for (const row of rows) {
    entries[row.entry_name] = row.connection_count;
  }

  return entries;
}

function getTopIps(db: Db, snapshotId: number): TopIpQueryItem[] {
  const rows = db
    .prepare(
      'SELECT ip, connection_count, entry_breakdown_json, rank FROM snapshot_top_ips WHERE snapshot_id = ? ORDER BY rank ASC',
    )
    .all(snapshotId) as TopIpRow[];

  return rows.map((row) => ({
    ip: row.ip,
    connectionCount: row.connection_count,
    entryBreakdown: JSON.parse(row.entry_breakdown_json) as Record<EntryName, number>,
    rank: row.rank,
  }));
}

export function windowMinutesForRange(range: RangeValue): number {
  const windows: Record<RangeValue, number> = {
    '30m': 30,
    '24h': 1440,
    '7d': 10080,
    '30d': 43200,
    '90d': 129600,
  };
  return windows[range];
}
