import cors from '@fastify/cors';
import Fastify from 'fastify';
import type { SummaryResponse } from '@ipcheck/shared';

export function buildApp() {
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

  app.get('/api/summary', async (): Promise<SummaryResponse> => ({
    generatedAt: new Date().toISOString(),
    range: '7d',
    totalConnections: 0,
    uniqueIps: 0,
    sevenDayTotalConnections: 0,
    sevenDayUniqueIps: 0,
    entries: [
      { entryName: 'ws', connectionCount: 0 },
      { entryName: 'ws1', connectionCount: 0 },
      { entryName: 'ws2', connectionCount: 0 },
      { entryName: 'ws3', connectionCount: 0 },
    ],
    topIps: [],
    status: 'ok',
  }));

  return app;
}
