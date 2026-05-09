import type { Db } from './index.js';

export interface CollectionRunInput {
  startedAt: string;
  finishedAt?: string | null;
  status: 'running' | 'ok' | 'error';
  logsRead?: number;
  linesScanned?: number;
  connectionsMatched?: number;
  errorMessage?: string | null;
}

export function insertCollectionRun(db: Db, run: CollectionRunInput): number {
  const result = db
    .prepare(`
      INSERT INTO collection_runs (
        started_at,
        finished_at,
        status,
        logs_read,
        lines_scanned,
        connections_matched,
        error_message
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      run.startedAt,
      run.finishedAt ?? null,
      run.status,
      run.logsRead ?? 0,
      run.linesScanned ?? 0,
      run.connectionsMatched ?? 0,
      run.errorMessage ?? null,
    );

  return Number(result.lastInsertRowid);
}
