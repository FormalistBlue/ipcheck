import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDatabase, insertSnapshot } from './db/index.js';
import { insertCollectionRun } from './db/collectionRuns.js';
import { buildApp } from './app.js';

function seedSnapshot(db = createDatabase(':memory:')) {
  insertSnapshot(db, {
    createdAt: '2026-05-09T04:00:00.000Z',
    windowMinutes: 10080,
    totalConnections: 42,
    uniqueIps: 2,
    status: 'ok',
    message: 'OK 7d total:42 unique:2',
    rawSummary: { generatedAt: '2026-05-09T04:00:00.000Z' },
    entries: [
      { entryName: 'ws', connectionCount: 30 },
      { entryName: 'ws1', connectionCount: 12 },
      { entryName: 'ws2', connectionCount: 0 },
      { entryName: 'ws3', connectionCount: 0 },
    ],
    topIps: [
      {
        ip: '221.237.156.241',
        connectionCount: 35,
        entryBreakdown: { ws: 25, ws1: 10, ws2: 0, ws3: 0 },
        rank: 1,
      },
      {
        ip: '171.213.246.90',
        connectionCount: 7,
        entryBreakdown: { ws: 5, ws1: 2, ws2: 0, ws3: 0 },
        rank: 2,
      },
    ],
  });

  insertSnapshot(db, {
    createdAt: '2026-05-09T04:10:00.000Z',
    windowMinutes: 10080,
    totalConnections: 50,
    uniqueIps: 3,
    status: 'ok',
    message: 'OK 7d total:50 unique:3',
    rawSummary: { generatedAt: '2026-05-09T04:10:00.000Z' },
    entries: [
      { entryName: 'ws', connectionCount: 35 },
      { entryName: 'ws1', connectionCount: 15 },
      { entryName: 'ws2', connectionCount: 0 },
      { entryName: 'ws3', connectionCount: 0 },
    ],
    topIps: [
      {
        ip: '221.237.156.241',
        connectionCount: 40,
        entryBreakdown: { ws: 28, ws1: 12, ws2: 0, ws3: 0 },
        rank: 1,
      },
      {
        ip: '171.213.246.90',
        connectionCount: 10,
        entryBreakdown: { ws: 7, ws1: 3, ws2: 0, ws3: 0 },
        rank: 2,
      },
    ],
  });

  insertCollectionRun(db, {
    startedAt: '2026-05-09T04:10:00.000Z',
    finishedAt: '2026-05-09T04:10:02.000Z',
    status: 'ok',
    logsRead: 4,
    linesScanned: 100,
    connectionsMatched: 50,
  });

  return db;
}

test('GET /api/summary returns latest snapshot for requested range', async () => {
  const db = seedSnapshot();
  const app = buildApp({ db });

  const response = await app.inject('/api/summary?range=7d');
  const body = response.json();

  assert.equal(response.statusCode, 200);
  assert.equal(body.range, '7d');
  assert.equal(body.totalConnections, 50);
  assert.equal(body.uniqueIps, 3);
  assert.equal(body.sevenDayTotalConnections, 50);
  assert.equal(body.entries[0].entryName, 'ws');
  assert.equal(body.topIps[0].ip, '221.237.156.241');

  await app.close();
  db.close();
});

test('GET /api/top-ips, entries, snapshots, and timeseries expose dashboard data', async () => {
  const db = seedSnapshot();
  const app = buildApp({ db });

  const topIpsResponse = await app.inject('/api/top-ips?range=7d&limit=10');
  assert.equal(topIpsResponse.statusCode, 200);
  const topIps = topIpsResponse.json();
  assert.equal(topIps.items.length, 2);
  assert.equal(topIps.items[0].rank, 1);

  const entries = (await app.inject('/api/entries?range=7d')).json();
  assert.equal(entries.items.length, 4);
  assert.equal(entries.items[0].connectionCount, 35);

  const snapshots = (await app.inject('/api/snapshots/recent?limit=1')).json();
  assert.equal(snapshots.items.length, 1);
  assert.equal(snapshots.items[0].totalConnections, 50);

  const timeseries = (await app.inject('/api/timeseries?range=7d&bucket=10m')).json();
  assert.equal(timeseries.items.length, 2);
  assert.deepEqual(timeseries.items[1].entries.ws, 35);

  await app.close();
  db.close();
});

test('API rejects invalid range parameters with readable errors', async () => {
  const db = seedSnapshot();
  const app = buildApp({ db });

  const response = await app.inject('/api/summary?range=bad');
  const body = response.json();

  assert.equal(response.statusCode, 400);
  assert.equal(body.error, 'INVALID_RANGE');

  await app.close();
  db.close();
});
