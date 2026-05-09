import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
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
const DEFAULT_STATIC_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../web/dist');

type BucketValue = (typeof BUCKET_VALUES)[number];

export interface BuildAppOptions {
  db?: Db;
  staticRoot?: string | false;
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
    const query = request.query as { limit?: string; range?: string };
    const limit = parseBoundedInt(query.limit, 20, 1, 100);
    const range = query.range ? parseRange(query.range) : null;
    if (!limit) {
      return sendBadRequest(reply, 'INVALID_LIMIT', 'limit must be between 1 and 100');
    }
    if (query.range && !range) {
      return sendBadRequest(reply, 'INVALID_RANGE', 'range must be one of 30m, 24h, 7d, 30d, 90d');
    }

    return {
      items: listRecentSnapshots(db, limit, range ? windowMinutesForRange(range) : undefined),
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

    const windowMinutes = windowMinutesForRange(range);
    const latest = getLatestSnapshotForWindow(db, windowMinutes);
    const since = latest ? sinceIso(latest.createdAt, windowMinutes) : undefined;
    const snapshots = bucketSnapshots(listSnapshotsForWindow(db, windowMinutes, since), bucketMinutesForBucket(bucket));

    return {
      range,
      bucket,
      items: snapshots.map((snapshot) => ({
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

  registerStaticFrontend(app, options.staticRoot);

  return app;
}

function parseRange(value: string): RangeValue | null {
  return RANGE_VALUES.includes(value as RangeValue) ? (value as RangeValue) : null;
}

function parseBucket(value: string): BucketValue | null {
  return BUCKET_VALUES.includes(value as BucketValue) ? (value as BucketValue) : null;
}

function bucketMinutesForBucket(bucket: BucketValue): number {
  const buckets: Record<BucketValue, number> = {
    '10m': 10,
    '1h': 60,
    '1d': 1440,
  };
  return buckets[bucket];
}

function bucketSnapshots<T extends { createdAt: string }>(snapshots: T[], bucketMinutes: number): T[] {
  if (bucketMinutes <= 10) {
    return snapshots;
  }

  const buckets = new Map<number, T>();
  for (const snapshot of snapshots) {
    const bucketStart = Math.floor(new Date(snapshot.createdAt).getTime() / (bucketMinutes * 60_000));
    buckets.set(bucketStart, snapshot);
  }
  return [...buckets.entries()].sort(([a], [b]) => a - b).map(([, snapshot]) => snapshot);
}

function sinceIso(latestIso: string, windowMinutes: number): string {
  return new Date(new Date(latestIso).getTime() - windowMinutes * 60_000).toISOString();
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

function registerStaticFrontend(app: FastifyInstance, configuredRoot?: string | false): void {
  if (configuredRoot === false) {
    return;
  }

  const staticRoot = configuredRoot ?? process.env.IPCHECK_WEB_DIST ?? DEFAULT_STATIC_ROOT;
  if (!existsSync(staticRoot)) {
    app.log.warn({ staticRoot }, 'frontend dist directory not found; static serving disabled');
    return;
  }

  app.register(fastifyStatic, {
    root: staticRoot,
    prefix: '/',
    index: ['index.html'],
    maxAge: '1h',
  });

  app.setNotFoundHandler((request, reply) => {
    if ((request.method === 'GET' || request.method === 'HEAD') && !request.url.startsWith('/api/')) {
      return reply.type('text/html; charset=utf-8').sendFile('index.html');
    }

    return reply.code(404).send({
      message: `Route ${request.method}:${request.url} not found`,
      error: 'Not Found',
      statusCode: 404,
    });
  });
}
