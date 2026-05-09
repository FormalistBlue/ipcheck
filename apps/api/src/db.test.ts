import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  cleanupOldSnapshots,
  createDatabase,
  getLatestSnapshot,
  insertSnapshot,
} from './db/index.js';

test('database initializes required tables and returns latest snapshot with entries and top IPs', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ipcheck-db-'));

  try {
    const db = createDatabase(join(dir, 'ipcheck.db'));

    const snapshotId = insertSnapshot(db, {
      createdAt: '2026-05-09T00:00:00.000Z',
      windowMinutes: 10080,
      totalConnections: 42,
      uniqueIps: 3,
      status: 'ok',
      message: 'OK 7d total:42 unique:3',
      rawSummary: { source: 'test' },
      entries: [
        { entryName: 'ws', connectionCount: 30 },
        { entryName: 'ws1', connectionCount: 12 },
      ],
      topIps: [
        {
          ip: '221.237.156.241',
          connectionCount: 20,
          entryBreakdown: { ws: 18, ws1: 2, ws2: 0, ws3: 0 },
          rank: 1,
        },
      ],
    });

    assert.equal(typeof snapshotId, 'number');

    const latest = getLatestSnapshot(db);
    assert.equal(latest?.totalConnections, 42);
    assert.equal(latest?.entries.length, 2);
    assert.equal(latest?.topIps[0]?.ip, '221.237.156.241');
    assert.deepEqual(latest?.rawSummary, { source: 'test' });

    db.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('cleanupOldSnapshots removes snapshots older than retention cutoff', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ipcheck-db-'));

  try {
    const db = createDatabase(join(dir, 'ipcheck.db'));

    insertSnapshot(db, {
      createdAt: '2025-01-01T00:00:00.000Z',
      windowMinutes: 10080,
      totalConnections: 1,
      uniqueIps: 1,
      status: 'ok',
      message: 'old',
      rawSummary: {},
      entries: [],
      topIps: [],
    });

    insertSnapshot(db, {
      createdAt: '2026-05-01T00:00:00.000Z',
      windowMinutes: 10080,
      totalConnections: 2,
      uniqueIps: 2,
      status: 'ok',
      message: 'fresh',
      rawSummary: {},
      entries: [],
      topIps: [],
    });

    const deleted = cleanupOldSnapshots(db, '2026-05-09T00:00:00.000Z', 180);
    assert.equal(deleted, 1);

    const latest = getLatestSnapshot(db);
    assert.equal(latest?.message, 'fresh');

    db.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
