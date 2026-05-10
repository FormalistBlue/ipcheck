import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createDatabase, getLatestSnapshot } from './db/index.js';
import { collectOnce, parseOpenRestyAccessLine, summarizeEvents } from './collector/index.js';

const sample101 =
  '172.68.118.127 - - [09/May/2026:11:59:04 +0800] "GET /dw2026ws HTTP/1.1" 101 913 "-" "Go-http-client/1.1" "198.51.100.10"';

test('parseOpenRestyAccessLine returns real x-forwarded-for IP for websocket 101 lines', () => {
  const event = parseOpenRestyAccessLine('ws', sample101);

  assert.equal(event?.entryName, 'ws');
  assert.equal(event?.ip, '198.51.100.10');
  assert.equal(event?.path, '/dw2026ws');
  assert.equal(event?.timestamp, '2026-05-09T03:59:04.000Z');
});

test('parseOpenRestyAccessLine ignores non-101 lines and missing forwarded IPs', () => {
  const redirected = sample101.replace('" 101 913', '" 301 166');
  const missingIp = sample101.replace('"198.51.100.10"', '"-"');

  assert.equal(parseOpenRestyAccessLine('ws', redirected), null);
  assert.equal(parseOpenRestyAccessLine('ws', missingIp), null);
});

test('summarizeEvents computes window totals, entry counts, and top IP breakdowns', () => {
  const events = [
    { entryName: 'ws' as const, ip: '1.1.1.1', path: '/dw2026ws', timestamp: '2026-05-09T00:00:00.000Z' },
    { entryName: 'ws1' as const, ip: '1.1.1.1', path: '/dw2026ws', timestamp: '2026-05-09T00:01:00.000Z' },
    { entryName: 'ws' as const, ip: '2.2.2.2', path: '/dw2026ws', timestamp: '2026-05-09T00:02:00.000Z' },
  ];

  const summary = summarizeEvents(events, 30, '2026-05-09T00:10:00.000Z', 10);

  assert.equal(summary.totalConnections, 3);
  assert.equal(summary.uniqueIps, 2);
  assert.deepEqual(summary.entries, [
    { entryName: 'ws', connectionCount: 2 },
    { entryName: 'ws1', connectionCount: 1 },
    { entryName: 'ws2', connectionCount: 0 },
    { entryName: 'ws3', connectionCount: 0 },
  ]);
  assert.deepEqual(summary.topIps[0], {
    ip: '1.1.1.1',
    connectionCount: 2,
    entryBreakdown: { ws: 1, ws1: 1, ws2: 0, ws3: 0 },
    rank: 1,
  });
});

test('summarizeEvents excludes log lines newer than the snapshot time', () => {
  const events = [
    { entryName: 'ws' as const, ip: '1.1.1.1', path: '/dw2026ws', timestamp: '2026-05-09T00:09:00.000Z' },
    { entryName: 'ws1' as const, ip: '2.2.2.2', path: '/dw2026ws', timestamp: '2026-05-09T00:11:00.000Z' },
  ];

  const summary = summarizeEvents(events, 30, '2026-05-09T00:10:00.000Z', 10);

  assert.equal(summary.totalConnections, 1);
  assert.equal(summary.uniqueIps, 1);
  assert.deepEqual(summary.entries, [
    { entryName: 'ws', connectionCount: 1 },
    { entryName: 'ws1', connectionCount: 0 },
    { entryName: 'ws2', connectionCount: 0 },
    { entryName: 'ws3', connectionCount: 0 },
  ]);
});

test('collectOnce marks snapshots warning/error when log reads fail', async () => {
  const db = createDatabase(':memory:');

  const warningRun = await collectOnce(db, {
    dryRun: true,
    logs: [
      { entryName: 'ws', path: '/tmp/does-not-exist.log' },
      { entryName: 'ws1', path: '/tmp/missing-too.log' },
    ],
    now: '2026-05-09T04:05:00.000Z',
    windows: [30],
    tailLines: 100,
    topLimit: 10,
  });

  assert.equal(warningRun.errors.length, 2);
  assert.equal(warningRun.snapshots[0]?.status, 'error');

  db.close();
});

test('collectOnce supports dry-run without writing snapshots and writes collection runs when persisted', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ipcheck-collector-'));

  try {
    const logPath = join(dir, 'ws.log');
    await writeFile(
      logPath,
      [
        sample101,
        sample101.replace('198.51.100.10', '198.51.100.11'),
        sample101.replace('" 101 913', '" 404 5'),
      ].join('\n'),
    );

    const db = createDatabase(join(dir, 'ipcheck.db'));
    const logs = [{ entryName: 'ws' as const, path: logPath }];

    const dryRun = await collectOnce(db, {
      logs,
      dryRun: true,
      now: '2026-05-09T04:05:00.000Z',
      windows: [30],
      tailLines: 100,
      topLimit: 10,
    });

    assert.equal(dryRun.snapshots[0]?.totalConnections, 2);
    assert.equal(getLatestSnapshot(db), null);

    const persisted = await collectOnce(db, {
      logs,
      dryRun: false,
      now: '2026-05-09T04:05:00.000Z',
      windows: [30],
      tailLines: 100,
      topLimit: 10,
    });

    assert.equal(persisted.snapshots[0]?.totalConnections, 2);
    assert.equal(getLatestSnapshot(db)?.totalConnections, 2);

    const run = db.prepare('SELECT * FROM collection_runs ORDER BY id DESC LIMIT 1').get() as {
      status: string;
      logs_read: number;
      lines_scanned: number;
      connections_matched: number;
    };
    assert.equal(run.status, 'ok');
    assert.equal(run.logs_read, 1);
    assert.equal(run.lines_scanned, 3);
    assert.equal(run.connections_matched, 2);

    db.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
