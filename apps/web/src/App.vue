<script setup lang="ts">
import type { SummaryResponse } from '@ipcheck/shared';

const placeholderSummary: SummaryResponse = {
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
};
</script>

<template>
  <main class="dashboard-shell">
    <section class="hero-card">
      <p class="eyebrow">Xray WebSocket Real IP Dashboard</p>
      <h1>ipcheck</h1>
      <p class="hero-copy">
        A focused monitoring surface for ws/ws1/ws2/ws3 real client IP traffic.
      </p>
      <div class="metric-grid">
        <article class="metric-card">
          <span>7d connections</span>
          <strong>{{ placeholderSummary.sevenDayTotalConnections }}</strong>
        </article>
        <article class="metric-card">
          <span>7d unique IPs</span>
          <strong>{{ placeholderSummary.sevenDayUniqueIps }}</strong>
        </article>
        <article class="metric-card">
          <span>Status</span>
          <strong>{{ placeholderSummary.status.toUpperCase() }}</strong>
        </article>
      </div>
    </section>
  </main>
</template>
