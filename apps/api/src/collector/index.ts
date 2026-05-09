import { readFile } from 'node:fs/promises';
import type { EntryName } from '@ipcheck/shared';
import {
  cleanupOldSnapshots,
  insertSnapshot,
  type Db,
  type SnapshotInput,
  type SnapshotTopIpInput,
} from '../db/index.js';
import { insertCollectionRun } from '../db/collectionRuns.js';

export const ENTRY_NAMES: EntryName[] = ['ws', 'ws1', 'ws2', 'ws3'];

export const RANGE_WINDOWS = {
  '30m': 30,
  '24h': 24 * 60,
  '7d': 7 * 24 * 60,
  '30d': 30 * 24 * 60,
  '90d': 90 * 24 * 60,
} as const;

export const DEFAULT_LOGS: CollectorLogConfig[] = [
  {
    entryName: 'ws',
    path: '/opt/1panel/apps/openresty/openresty/www/sites/ws.shandawang.cc/log/access.log',
  },
  {
    entryName: 'ws1',
    path: '/opt/1panel/apps/openresty/openresty/www/sites/ws1.shandawang.cc/log/access.log',
  },
  {
    entryName: 'ws2',
    path: '/opt/1panel/apps/openresty/openresty/www/sites/ws2.shandawang.cc/log/access.log',
  },
  {
    entryName: 'ws3',
    path: '/opt/1panel/apps/openresty/openresty/www/sites/ws3.shandawang.cc/log/access.log',
  },
];

const TIME_RE = /\[([^\]]+)\]/;
const QUOTED_RE = /"([^"]*)"/g;
const DEFAULT_WINDOWS = Object.values(RANGE_WINDOWS);

export interface CollectorLogConfig {
  entryName: EntryName;
  path: string;
}

export interface ParsedAccessEvent {
  entryName: EntryName;
  ip: string;
  path: string;
  timestamp: string;
}

export interface CollectorSnapshotSummary extends SnapshotInput {
  rangeLabel: string;
}

export interface CollectResult {
  dryRun: boolean;
  startedAt: string;
  finishedAt: string;
  logsRead: number;
  linesScanned: number;
  connectionsMatched: number;
  snapshots: CollectorSnapshotSummary[];
  errors: string[];
}

export interface CollectOptions {
  logs?: CollectorLogConfig[];
  dryRun?: boolean;
  now?: string;
  windows?: number[];
  tailLines?: number;
  topLimit?: number;
  retentionDays?: number;
}

export function parseOpenRestyAccessLine(entryName: EntryName, line: string): ParsedAccessEvent | null {
  if (!line.includes('" 101 ')) {
    return null;
  }

  const timestamp = parseOpenRestyTimestamp(line);
  if (!timestamp) {
    return null;
  }

  const quotedFields = [...line.matchAll(QUOTED_RE)].map((match) => match[1] ?? '');
  if (quotedFields.length < 4) {
    return null;
  }

  const request = quotedFields[0] ?? '';
  const forwardedFor = quotedFields[quotedFields.length - 1] ?? '';
  const ip = forwardedFor.split(',')[0]?.trim() ?? '';
  if (!ip || ip === '-') {
    return null;
  }

  const requestParts = request.split(/\s+/);
  const path = requestParts.length >= 2 ? requestParts[1] : request;

  return {
    entryName,
    ip,
    path,
    timestamp,
  };
}

export function summarizeEvents(
  events: ParsedAccessEvent[],
  windowMinutes: number,
  nowIso: string,
  topLimit: number,
): CollectorSnapshotSummary {
  const cutoff = new Date(new Date(nowIso).getTime() - windowMinutes * 60_000).getTime();
  const inWindow = events.filter((event) => new Date(event.timestamp).getTime() >= cutoff);
  const entryCounts = new Map<EntryName, number>(ENTRY_NAMES.map((entry) => [entry, 0]));
  const ipCounts = new Map<string, number>();
  const ipEntryCounts = new Map<string, Map<EntryName, number>>();

  for (const event of inWindow) {
    entryCounts.set(event.entryName, (entryCounts.get(event.entryName) ?? 0) + 1);
    ipCounts.set(event.ip, (ipCounts.get(event.ip) ?? 0) + 1);

    const breakdown = ipEntryCounts.get(event.ip) ?? new Map<EntryName, number>();
    breakdown.set(event.entryName, (breakdown.get(event.entryName) ?? 0) + 1);
    ipEntryCounts.set(event.ip, breakdown);
  }

  const topIps: SnapshotTopIpInput[] = [...ipCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, topLimit)
    .map(([ip, connectionCount], index) => ({
      ip,
      connectionCount,
      entryBreakdown: buildEntryBreakdown(ipEntryCounts.get(ip)),
      rank: index + 1,
    }));

  const entries = ENTRY_NAMES.map((entryName) => ({
    entryName,
    connectionCount: entryCounts.get(entryName) ?? 0,
  }));

  const rangeLabel = rangeLabelForWindow(windowMinutes);
  const message = buildSummaryMessage(rangeLabel, inWindow.length, ipCounts.size, entries, topIps);

  return {
    rangeLabel,
    createdAt: nowIso,
    windowMinutes,
    totalConnections: inWindow.length,
    uniqueIps: ipCounts.size,
    status: 'ok',
    message,
    rawSummary: {
      range: rangeLabel,
      generatedAt: nowIso,
      totalConnections: inWindow.length,
      uniqueIps: ipCounts.size,
      entries,
      topIps,
    },
    entries,
    topIps,
  };
}

export async function collectOnce(db: Db, options: CollectOptions = {}): Promise<CollectResult> {
  const startedAt = new Date().toISOString();
  const now = options.now ?? startedAt;
  const logs = options.logs ?? DEFAULT_LOGS;
  const windows = options.windows ?? DEFAULT_WINDOWS;
  const tailLines = options.tailLines ?? Number.parseInt(process.env.IPCHECK_TAIL_LINES ?? '500000', 10);
  const topLimit = options.topLimit ?? 10;
  const dryRun = options.dryRun ?? false;
  const retentionDays = options.retentionDays ?? 180;
  const errors: string[] = [];
  const events: ParsedAccessEvent[] = [];
  let logsRead = 0;
  let linesScanned = 0;

  for (const log of logs) {
    try {
      const text = await readFile(log.path, 'utf8');
      const lines = tailLinesFromText(text, tailLines);
      logsRead += 1;
      linesScanned += lines.length;

      for (const line of lines) {
        const event = parseOpenRestyAccessLine(log.entryName, line);
        if (event) {
          events.push(event);
        }
      }
    } catch (error) {
      errors.push(`${log.entryName}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  events.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const snapshots = windows.map((windowMinutes) => summarizeEvents(events, windowMinutes, now, topLimit));
  const finishedAt = new Date().toISOString();

  if (!dryRun) {
    for (const snapshot of snapshots) {
      insertSnapshot(db, snapshot);
    }

    cleanupOldSnapshots(db, now, retentionDays);

    insertCollectionRun(db, {
      startedAt,
      finishedAt,
      status: errors.length > 0 ? 'error' : 'ok',
      logsRead,
      linesScanned,
      connectionsMatched: events.length,
      errorMessage: errors.length > 0 ? errors.join('; ') : null,
    });
  }

  return {
    dryRun,
    startedAt,
    finishedAt,
    logsRead,
    linesScanned,
    connectionsMatched: events.length,
    snapshots,
    errors,
  };
}

function parseOpenRestyTimestamp(line: string): string | null {
  const match = TIME_RE.exec(line);
  const value = match?.[1];
  if (!value) {
    return null;
  }

  const parsed = /^(\d{2})\/([A-Za-z]{3})\/(\d{4}):(\d{2}):(\d{2}):(\d{2}) ([+-]\d{4})$/.exec(value);
  if (!parsed) {
    return null;
  }

  const [, day, monthName, year, hour, minute, second, offset] = parsed;
  const month = monthNumber(monthName);
  if (!month) {
    return null;
  }

  const isoWithOffset = `${year}-${month}-${day}T${hour}:${minute}:${second}${offset.slice(0, 3)}:${offset.slice(3)}`;
  const date = new Date(isoWithOffset);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString();
}

function monthNumber(monthName: string): string | null {
  const months: Record<string, string> = {
    Jan: '01',
    Feb: '02',
    Mar: '03',
    Apr: '04',
    May: '05',
    Jun: '06',
    Jul: '07',
    Aug: '08',
    Sep: '09',
    Oct: '10',
    Nov: '11',
    Dec: '12',
  };

  return months[monthName] ?? null;
}

function buildEntryBreakdown(counts?: Map<EntryName, number>): Record<EntryName, number> {
  return {
    ws: counts?.get('ws') ?? 0,
    ws1: counts?.get('ws1') ?? 0,
    ws2: counts?.get('ws2') ?? 0,
    ws3: counts?.get('ws3') ?? 0,
  };
}

function rangeLabelForWindow(windowMinutes: number): string {
  const match = Object.entries(RANGE_WINDOWS).find(([, minutes]) => minutes === windowMinutes);
  return match?.[0] ?? `${windowMinutes}m`;
}

function buildSummaryMessage(
  rangeLabel: string,
  totalConnections: number,
  uniqueIps: number,
  entries: { entryName: EntryName; connectionCount: number }[],
  topIps: SnapshotTopIpInput[],
): string {
  const top = topIps
    .slice(0, 5)
    .map((item) => `${item.ip}(${item.connectionCount})`)
    .join(' | ');
  const entryText = entries.map((entry) => `${entry.entryName}:${entry.connectionCount}`).join(' | ');
  return `OK ${rangeLabel} total:${totalConnections} unique:${uniqueIps} || TOP: ${top || 'none'} || ENTRY: ${entryText}`;
}

function tailLinesFromText(text: string, maxLines: number): string[] {
  const lines = text.split(/\r?\n/).filter(Boolean);
  return lines.slice(Math.max(0, lines.length - maxLines));
}
