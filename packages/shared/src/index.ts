export const RANGE_VALUES = ['30m', '24h', '7d', '30d', '90d'] as const;

export type RangeValue = (typeof RANGE_VALUES)[number];

export type EntryName = 'ws' | 'ws1' | 'ws2' | 'ws3';

export interface EntryCount {
  entryName: EntryName;
  connectionCount: number;
}

export interface TopIpItem {
  ip: string;
  connectionCount: number;
  entryBreakdown: Record<EntryName, number>;
}

export interface SummaryResponse {
  generatedAt: string;
  range: RangeValue;
  totalConnections: number;
  uniqueIps: number;
  sevenDayTotalConnections: number;
  sevenDayUniqueIps: number;
  entries: EntryCount[];
  topIps: TopIpItem[];
  status: 'ok' | 'warning' | 'error';
}
