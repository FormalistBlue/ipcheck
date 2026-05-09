<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { RANGE_VALUES, type EntryName, type RangeValue, type SummaryResponse } from '@ipcheck/shared';
import { fetchDashboardData, type DashboardData, type TimeSeriesItem } from './api';

const ENTRY_NAMES: EntryName[] = ['ws', 'ws1', 'ws2', 'ws3'];
const ENTRY_LABELS: Record<EntryName, string> = {
  ws: '主入口 ws',
  ws1: '入口 ws1',
  ws2: '入口 ws2',
  ws3: '入口 ws3',
};
const ENTRY_COLORS: Record<EntryName, string> = {
  ws: '#c2ef4e',
  ws1: '#6a5fc1',
  ws2: '#ffb287',
  ws3: '#fa7faa',
};

const selectedRange = ref<RangeValue>('7d');
const data = ref<DashboardData | null>(null);
const isLoading = ref(true);
const isRefreshing = ref(false);
const errorMessage = ref('');
const lastRefreshedAt = ref('');
let refreshTimer: number | undefined;

const summary = computed<SummaryResponse | null>(() => data.value?.summary ?? null);
const hasData = computed(() => Boolean(summary.value && (summary.value.totalConnections > 0 || data.value?.timeseries.length)));
const latestSnapshot = computed(() => data.value?.snapshots[0] ?? null);
const chartMax = computed(() => Math.max(1, ...(data.value?.timeseries.map((item) => item.totalConnections) ?? [0])));
const entryTotal = computed(() => Math.max(1, ...(summary.value?.entries.map((entry) => entry.connectionCount) ?? [0])));
const totalEntryConnections = computed(() => summary.value?.entries.reduce((total, entry) => total + entry.connectionCount, 0) ?? 0);
const heatmapCells = computed(() => buildHeatmap(data.value?.timeseries ?? []));
const topRuns = computed(() => data.value?.runs.slice(0, 8) ?? []);

onMounted(() => {
  void loadDashboard();
  refreshTimer = window.setInterval(() => {
    void loadDashboard(true);
  }, 10 * 60 * 1000);
});

onUnmounted(() => {
  if (refreshTimer) window.clearInterval(refreshTimer);
});

async function loadDashboard(background = false) {
  if (background) {
    isRefreshing.value = true;
  } else {
    isLoading.value = true;
  }
  errorMessage.value = '';

  try {
    data.value = await fetchDashboardData(selectedRange.value);
    lastRefreshedAt.value = new Date().toLocaleString('zh-CN', { hour12: false });
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : 'Dashboard data request failed';
  } finally {
    isLoading.value = false;
    isRefreshing.value = false;
  }
}

function selectRange(range: RangeValue) {
  if (range === selectedRange.value) return;
  selectedRange.value = range;
  void loadDashboard();
}

function formatNumber(value = 0) {
  return new Intl.NumberFormat('en-US').format(value);
}

function formatTime(value?: string | null) {
  if (!value) return '-';
  return new Date(value).toLocaleString('zh-CN', { hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function formatWindow(minutes: number) {
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 1440) return `${Math.round(minutes / 60)}h`;
  return `${Math.round(minutes / 1440)}d`;
}

function totalForEntries(entries: Record<EntryName, number>) {
  return ENTRY_NAMES.reduce((total, name) => total + (entries[name] ?? 0), 0);
}

function linePoints(items: TimeSeriesItem[]) {
  if (!items.length) return '';
  const width = 640;
  const height = 180;
  const max = Math.max(1, ...items.map((item) => item.totalConnections));
  return items
    .map((item, index) => {
      const x = items.length === 1 ? width : (index / (items.length - 1)) * width;
      const y = height - (item.totalConnections / max) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}

function entryLinePoints(items: TimeSeriesItem[], entryName: EntryName) {
  if (!items.length) return '';
  const width = 640;
  const height = 180;
  const max = Math.max(1, ...items.flatMap((item) => ENTRY_NAMES.map((name) => item.entries[name] ?? 0)));
  return items
    .map((item, index) => {
      const x = items.length === 1 ? width : (index / (items.length - 1)) * width;
      const y = height - ((item.entries[entryName] ?? 0) / max) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}

function donutStyle(entry: { entryName: EntryName; connectionCount: number }, index: number) {
  const entries = summary.value?.entries ?? [];
  const total = Math.max(1, entries.reduce((sum, item) => sum + item.connectionCount, 0));
  const start = entries.slice(0, index).reduce((sum, item) => sum + item.connectionCount, 0) / total * 360;
  const end = start + (entry.connectionCount / total) * 360;
  return `${ENTRY_COLORS[entry.entryName]} ${start}deg ${end}deg`;
}

function buildHeatmap(items: TimeSeriesItem[]) {
  const max = Math.max(1, ...items.map((item) => item.totalConnections));
  return items.slice(-48).map((item) => ({
    timestamp: item.timestamp,
    value: item.totalConnections,
    intensity: Math.max(0.08, item.totalConnections / max),
  }));
}

function statusText(status?: string) {
  if (status === 'ok') return '正常';
  if (status === 'warning') return '注意';
  if (status === 'error') return '异常';
  if (status === 'running') return '运行中';
  return '未知';
}
</script>

<template>
  <main class="dashboard-shell">
    <section class="hero-card reveal">
      <div class="hero-content">
        <p class="eyebrow">Xray WebSocket Real IP Dashboard</p>
        <h1>ipcheck</h1>
        <p class="hero-copy">
          追踪 ws / ws1 / ws2 / ws3 的真实客户端 IP 连接量，聚合 30m 到 90d 的趋势、入口分布和采集状态。
        </p>
      </div>
      <div class="hero-panel">
        <span class="panel-label">当前窗口</span>
        <div class="range-switcher" aria-label="选择统计时间范围">
          <button
            v-for="range in RANGE_VALUES"
            :key="range"
            type="button"
            :class="['range-button', { active: range === selectedRange }]"
            @click="selectRange(range)"
          >
            {{ range }}
          </button>
        </div>
        <div class="refresh-row">
          <span>{{ isRefreshing ? '后台刷新中...' : `最后刷新 ${lastRefreshedAt || '-'}` }}</span>
          <button type="button" class="ghost-button" @click="loadDashboard()">立即刷新</button>
        </div>
      </div>
    </section>

    <section v-if="isLoading" class="state-card">正在加载 Dashboard 数据...</section>
    <section v-else-if="errorMessage" class="state-card error-state">
      <strong>数据加载失败</strong>
      <span>{{ errorMessage }}</span>
      <button type="button" class="ghost-button" @click="loadDashboard()">重试</button>
    </section>
    <section v-else-if="!hasData" class="state-card">
      <strong>暂无统计数据</strong>
      <span>先运行采集脚本写入 SQLite，Dashboard 会自动显示最新快照。</span>
    </section>

    <template v-else-if="summary && data">
      <section class="metric-grid reveal delay-1">
        <article class="metric-card accent">
          <span>{{ selectedRange }} connections</span>
          <strong>{{ formatNumber(summary.totalConnections) }}</strong>
          <small>7d total {{ formatNumber(summary.sevenDayTotalConnections) }}</small>
        </article>
        <article class="metric-card">
          <span>unique IPs</span>
          <strong>{{ formatNumber(summary.uniqueIps) }}</strong>
          <small>7d unique {{ formatNumber(summary.sevenDayUniqueIps) }}</small>
        </article>
        <article class="metric-card">
          <span>collector status</span>
          <strong>{{ statusText(summary.status) }}</strong>
          <small>{{ latestSnapshot?.message ?? '等待采集信息' }}</small>
        </article>
        <article class="metric-card">
          <span>top source</span>
          <strong>{{ summary.topIps[0]?.ip ?? '-' }}</strong>
          <small>{{ formatNumber(summary.topIps[0]?.connectionCount ?? 0) }} connections</small>
        </article>
      </section>

      <section class="dashboard-grid reveal delay-2">
        <article class="panel chart-panel wide">
          <div class="panel-heading">
            <div>
              <span class="panel-label">Total Trend</span>
              <h2>总连接趋势</h2>
            </div>
            <span class="mono">{{ data.timeseries.length }} points</span>
          </div>
          <svg viewBox="0 0 640 180" role="img" aria-label="总连接趋势折线图" class="line-chart">
            <defs>
              <linearGradient id="totalGradient" x1="0" x2="1" y1="0" y2="0">
                <stop stop-color="#c2ef4e" />
                <stop offset="1" stop-color="#6a5fc1" />
              </linearGradient>
            </defs>
            <polyline :points="linePoints(data.timeseries)" fill="none" stroke="url(#totalGradient)" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
          <div class="chart-axis">
            <span>{{ formatTime(data.timeseries[0]?.timestamp) }}</span>
            <span>max {{ formatNumber(chartMax) }}</span>
            <span>{{ formatTime(data.timeseries.at(-1)?.timestamp) }}</span>
          </div>
        </article>

        <article class="panel chart-panel wide">
          <div class="panel-heading">
            <div>
              <span class="panel-label">Entry Trend</span>
              <h2>分入口趋势</h2>
            </div>
          </div>
          <svg viewBox="0 0 640 180" role="img" aria-label="分入口趋势折线图" class="line-chart">
            <polyline v-for="name in ENTRY_NAMES" :key="name" :points="entryLinePoints(data.timeseries, name)" fill="none" :stroke="ENTRY_COLORS[name]" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
          <div class="legend-row">
            <span v-for="name in ENTRY_NAMES" :key="name"><i :style="{ background: ENTRY_COLORS[name] }" />{{ name }}</span>
          </div>
        </article>

        <article class="panel">
          <div class="panel-heading">
            <div>
              <span class="panel-label">Entry Share</span>
              <h2>入口分布</h2>
            </div>
          </div>
          <div class="donut" :style="{ background: `conic-gradient(${summary.entries.map(donutStyle).join(', ')})` }">
            <div><strong>{{ formatNumber(totalEntryConnections) }}</strong><span>connections</span></div>
          </div>
          <div class="entry-list">
            <div v-for="entry in summary.entries" :key="entry.entryName">
              <span><i :style="{ background: ENTRY_COLORS[entry.entryName] }" />{{ ENTRY_LABELS[entry.entryName] }}</span>
              <strong>{{ formatNumber(entry.connectionCount) }}</strong>
            </div>
          </div>
        </article>

        <article class="panel">
          <div class="panel-heading">
            <div>
              <span class="panel-label">Compare</span>
              <h2>入口对比</h2>
            </div>
          </div>
          <div class="bar-list">
            <div v-for="entry in summary.entries" :key="entry.entryName" class="bar-item">
              <span>{{ entry.entryName }}</span>
              <div><i :style="{ width: `${Math.max(4, (entry.connectionCount / entryTotal) * 100)}%`, background: ENTRY_COLORS[entry.entryName] }" /></div>
              <strong>{{ formatNumber(entry.connectionCount) }}</strong>
            </div>
          </div>
        </article>

        <article class="panel wide">
          <div class="panel-heading">
            <div>
              <span class="panel-label">Top 10 IP</span>
              <h2>高频来源排行</h2>
            </div>
          </div>
          <div class="top-ip-list">
            <div v-for="item in summary.topIps.slice(0, 10)" :key="item.ip" class="top-ip-row">
              <span class="rank">#{{ item.rank }}</span>
              <strong>{{ item.ip }}</strong>
              <div class="mini-breakdown">
                <i v-for="name in ENTRY_NAMES" :key="name" :style="{ width: `${Math.max(2, ((item.entryBreakdown[name] ?? 0) / Math.max(1, item.connectionCount)) * 100)}%`, background: ENTRY_COLORS[name] }" />
              </div>
              <span class="mono">{{ formatNumber(item.connectionCount) }}</span>
            </div>
          </div>
        </article>

        <article class="panel wide">
          <div class="panel-heading">
            <div>
              <span class="panel-label">Heatmap</span>
              <h2>时间热力图</h2>
            </div>
            <span class="mono">last {{ heatmapCells.length }} buckets</span>
          </div>
          <div class="heatmap-grid">
            <span
              v-for="cell in heatmapCells"
              :key="cell.timestamp"
              :title="`${formatTime(cell.timestamp)}: ${formatNumber(cell.value)}`"
              :style="{ opacity: cell.intensity, background: '#c2ef4e' }"
            />
          </div>
        </article>

        <article class="panel">
          <div class="panel-heading">
            <div>
              <span class="panel-label">Collector</span>
              <h2>采集状态时间线</h2>
            </div>
          </div>
          <div class="timeline-list">
            <div v-for="run in topRuns" :key="run.id" class="timeline-item">
              <i :class="run.status" />
              <div>
                <strong>{{ statusText(run.status) }}</strong>
                <span>{{ formatTime(run.startedAt) }} · {{ formatNumber(run.connectionsMatched) }} matched</span>
                <small v-if="run.errorMessage">{{ run.errorMessage }}</small>
              </div>
            </div>
          </div>
        </article>

        <article class="panel">
          <div class="panel-heading">
            <div>
              <span class="panel-label">Latest</span>
              <h2>最新统计详情</h2>
            </div>
          </div>
          <dl v-if="latestSnapshot" class="detail-list">
            <div><dt>生成时间</dt><dd>{{ formatTime(latestSnapshot.createdAt) }}</dd></div>
            <div><dt>统计窗口</dt><dd>{{ formatWindow(latestSnapshot.windowMinutes) }}</dd></div>
            <div><dt>连接数</dt><dd>{{ formatNumber(latestSnapshot.totalConnections) }}</dd></div>
            <div><dt>独立 IP</dt><dd>{{ formatNumber(latestSnapshot.uniqueIps) }}</dd></div>
            <div><dt>状态信息</dt><dd>{{ latestSnapshot.message }}</dd></div>
          </dl>
        </article>

        <article class="panel wide">
          <div class="panel-heading">
            <div>
              <span class="panel-label">Recent Snapshots</span>
              <h2>最近 20 次历史快照</h2>
            </div>
          </div>
          <div class="snapshot-table">
            <div class="snapshot-head"><span>时间</span><span>窗口</span><span>连接</span><span>独立 IP</span><span>入口合计</span><span>状态</span></div>
            <div v-for="snapshot in data.snapshots" :key="snapshot.id" class="snapshot-row">
              <span>{{ formatTime(snapshot.createdAt) }}</span>
              <span>{{ formatWindow(snapshot.windowMinutes) }}</span>
              <strong>{{ formatNumber(snapshot.totalConnections) }}</strong>
              <span>{{ formatNumber(snapshot.uniqueIps) }}</span>
              <span>{{ formatNumber(totalForEntries(snapshot.entries)) }}</span>
              <span :class="['status-pill', snapshot.status]">{{ statusText(snapshot.status) }}</span>
            </div>
          </div>
        </article>
      </section>
    </template>
  </main>
</template>
