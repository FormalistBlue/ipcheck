import cors from '@fastify/cors';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { RANGE_VALUES, type EntryName, type RangeValue, type SummaryResponse } from '@ipcheck/shared';
import { createDatabase, type Db } from './db/index.js';
import {
  getLatestSnapshotForWindow,
  listRecentRuns,
  listRecentSnapshots,
  listSnapshotsForWindow,
  listTopIpsForWindow,
  windowMinutesForRange,
} from './db/queries.js';

const DEFAULT_DB_PATH = '/var/lib/ipcheck/ipcheck.db';
const BUCKET_VALUES = ['10m', '1h', '1d'] as const;

type BucketValue = (typeof BUCKET_VALUES)[number];

export interface BuildAppOptions {
  db?: Db;
}

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const db = options.db ?? createDatabase(process.env.IPCHECK_DB_PATH ?? DEFAULT_DB_PATH);
  const app = Fastify({
    logger: true,
  });

  app.register(cors, {
    origin: true,
  });

  app.get('/api/health', async () => ({
    status: 'ok',
    service: 'ipcheck-api',
    time: new Date().toISOString(),
  }));

  app.get('/api/summary', async (request, reply): Promise<SummaryResponse | void> => {
    const range = parseRange((request.query as { range?: string }).range ?? '7d');
    if (!range) {
      return sendBadRequest(reply, 'INVALID_RANGE', 'range must be one of 30m, 24h, 7d, 30d, 90d');
    }

    const windowMinutes = windowMinutesForRange(range);
    const snapshot = getLatestSnapshotForWindow(db, windowMinutes);
    const sevenDaySnapshot = getLatestSnapshotForWindow(db, windowMinutesForRange('7d'));

    return {
      generatedAt: new Date().toISOString(),
      range,
      totalConnections: snapshot?.totalConnections ?? 0,
      uniqueIps: snapshot?.uniqueIps ?? 0,
      sevenDayTotalConnections: sevenDaySnapshot?.totalConnections ?? 0,
      sevenDayUniqueIps: sevenDaySnapshot?.uniqueIps ?? 0,
      entries: entriesArray(snapshot?.entries),
      topIps: snapshot?.topIps ?? [],
      status: snapshot?.status ?? 'warning',
    };
  });

  app.get('/api/top-ips', async (request, reply) => {
    const query = request.query as { range?: string; limit?: string };
    const range = parseRange(query.range ?? '7d');
    const limit = parseLimit(query.limit, 10, [10, 20, 50]);
    if (!range) {
      return sendBadRequest(reply, 'INVALID_RANGE', 'range must be one of 30m, 24h, 7d, 30d, 90d');
    }
    if (!limit) {
      return sendBadRequest(reply, 'INVALID_LIMIT', 'limit must be 10, 20, or 50');
    }

    return {
      range,
      items: listTopIpsForWindow(db, windowMinutesForRange(range), limit),
    };
  });

  app.get('/api/entries', async (request, reply) => {
    const range = parseRange((request.query as { range?: string }).range ?? '7d');
    if (!range) {
      return sendBadRequest(reply, 'INVALID_RANGE', 'range must be one of 30m, 24h, 7d, 30d, 90d');
    }

    const snapshot = getLatestSnapshotForWindow(db, windowMinutesForRange(range));
    return {
      range,
      items: entriesArray(snapshot?.entries),
    };
  });

  app.get('/api/snapshots/recent', async (request, reply) => {
    const limit = parseBoundedInt((request.query as { limit?: string }).limit, 20, 1, 100);
    if (!limit) {
      return sendBadRequest(reply, 'INVALID_LIMIT', 'limit must be between 1 and 100');
    }

    return {
      items: listRecentSnapshots(db, limit),
    };
  });

  app.get('/api/timeseries', async (request, reply) => {
    const query = request.query as { range?: string; bucket?: string };
    const range = parseRange(query.range ?? '7d');
    const bucket = parseBucket(query.bucket ?? '10m');
    if (!range) {
      return sendBadRequest(reply, 'INVALID_RANGE', 'range must be one of 30m, 24h, 7d, 30d, 90d');
    }
    if (!bucket) {
      return sendBadRequest(reply, 'INVALID_BUCKET', 'bucket must be one of 10m, 1h, 1d');
    }

    return {
      range,
      bucket,
      items: listSnapshotsForWindow(db, windowMinutesForRange(range)).map((snapshot) => ({
        timestamp: snapshot.createdAt,
        totalConnections: snapshot.totalConnections,
        uniqueIps: snapshot.uniqueIps,
        entries: snapshot.entries,
      })),
    };
  });

  app.get('/api/runs/recent', async (request, reply) => {
    const limit = parseBoundedInt((request.query as { limit?: string }).limit, 20, 1, 100);
    if (!limit) {
      return sendBadRequest(reply, 'INVALID_LIMIT', 'limit must be between 1 and 100');
    }

    return { items: listRecentRuns(db, limit) };
  });

  return app;
}

function parseRange(value: string): RangeValue | null {
  return RANGE_VALUES.includes(value as RangeValue) ? (value as RangeValue) : null;
}

function parseBucket(value: string): BucketValue | null {
  return BUCKET_VALUES.includes(value as BucketValue) ? (value as BucketValue) : null;
}

function parseLimit(value: string | undefined, defaultValue: number, allowed: number[]): number | null {
  const parsed = value ? Number.parseInt(value, 10) : defaultValue;
  return allowed.includes(parsed) ? parsed : null;
}

function parseBoundedInt(value: string | undefined, defaultValue: number, min: number, max: number): number | null {
  const parsed = value ? Number.parseInt(value, 10) : defaultValue;
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : null;
}

function entriesArray(entries?: Record<EntryName, number>) {
  const source = entries ?? { ws: 0, ws1: 0, ws2: 0, ws3: 0 };
  return [
    { entryName: 'ws' as const, connectionCount: source.ws },
    { entryName: 'ws1' as const, connectionCount: source.ws1 },
    { entryName: 'ws2' as const, connectionCount: source.ws2 },
    { entryName: 'ws3' as const, connectionCount: source.ws3 },
  ];
}

function sendBadRequest(reply: { code: (statusCode: number) => { send: (payload: unknown) => void } }, error: string, message: string) {
  return reply.code(400).send({ error, message });
}
