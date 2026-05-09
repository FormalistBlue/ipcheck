import type { EntryName, RangeValue, SummaryResponse } from '@ipcheck/shared';

export interface TimeSeriesItem {
  timestamp: string;
  totalConnections: number;
  uniqueIps: number;
  entries: Record<EntryName, number>;
}

export interface SnapshotItem {
  id: number;
  createdAt: string;
  windowMinutes: number;
  totalConnections: number;
  uniqueIps: number;
  status: 'ok' | 'warning' | 'error';
  message: string;
  entries: Record<EntryName, number>;
}

export interface RunItem {
  id: number;
  startedAt: string;
  finishedAt: string | null;
  status: 'running' | 'ok' | 'error';
  logsRead: number;
  linesScanned: number;
  connectionsMatched: number;
  errorMessage: string | null;
}

export interface DashboardData {
  summary: SummaryResponse;
  timeseries: TimeSeriesItem[];
  snapshots: SnapshotItem[];
  runs: RunItem[];
}

export async function fetchDashboardData(range: RangeValue, fetcher: typeof fetch = fetch): Promise<DashboardData> {
  const [summary, timeseries, snapshots, runs] = await Promise.all([
    getJson<SummaryResponse>(`/api/summary?range=${range}`, fetcher),
    getJson<{ items: TimeSeriesItem[] }>(`/api/timeseries?range=${range}&bucket=${bucketForRange(range)}`, fetcher),
    getJson<{ items: SnapshotItem[] }>('/api/snapshots/recent?limit=20', fetcher),
    getJson<{ items: RunItem[] }>('/api/runs/recent?limit=20', fetcher),
  ]);

  return {
    summary,
    timeseries: timeseries.items,
    snapshots: snapshots.items,
    runs: runs.items,
  };
}

export function bucketForRange(range: RangeValue): '10m' | '1h' | '1d' {
  if (range === '30m' || range === '24h') return '10m';
  if (range === '7d') return '1h';
  return '1d';
}

async function getJson<T>(path: string, fetcher: typeof fetch): Promise<T> {
  const response = await fetcher(path);
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status} ${path}`);
  }
  return response.json() as Promise<T>;
}
