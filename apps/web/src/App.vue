<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { BarChart, HeatmapChart, LineChart, PieChart } from 'echarts/charts';
import { GridComponent, LegendComponent, TitleComponent, TooltipComponent, VisualMapComponent } from 'echarts/components';
import { use } from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import type { EChartsOption } from 'echarts';
import VChart from 'vue-echarts';
import { RANGE_VALUES, type EntryName, type RangeValue, type SummaryResponse } from '@ipcheck/shared';
import { fetchDashboardData, type DashboardData, type TimeSeriesItem } from './api';

use([BarChart, HeatmapChart, LineChart, PieChart, GridComponent, LegendComponent, TitleComponent, TooltipComponent, VisualMapComponent, CanvasRenderer]);

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

const chartAxisLabel = {
  color: '#9086aa',
  fontFamily: 'JetBrains Mono, ui-monospace, monospace',
};
const chartTextStyle = {
  color: '#c9c2d8',
  fontFamily: 'Rubik, system-ui, sans-serif',
};
const chartGridLine = {
  color: 'rgba(255, 255, 255, 0.08)',
};

const summary = computed<SummaryResponse | null>(() => data.value?.summary ?? null);
const hasData = computed(() => Boolean(summary.value && (summary.value.totalConnections > 0 || data.value?.timeseries.length)));
const latestSnapshot = computed(() => data.value?.snapshots[0] ?? null);
const totalEntryConnections = computed(() => summary.value?.entries.reduce((total, entry) => total + entry.connectionCount, 0) ?? 0);
const heatmapCells = computed(() => buildHeatmap(data.value?.timeseries ?? []));
const topRuns = computed(() => data.value?.runs.slice(0, 8) ?? []);
const totalTrendOption = computed<EChartsOption>(() => buildTotalTrendOption(data.value?.timeseries ?? []));
const entryTrendOption = computed<EChartsOption>(() => buildEntryTrendOption(data.value?.timeseries ?? []));
const entryShareOption = computed<EChartsOption>(() => buildEntryShareOption(summary.value));
const entryCompareOption = computed<EChartsOption>(() => buildEntryCompareOption(summary.value));
const topIpOption = computed<EChartsOption>(() => buildTopIpOption(summary.value));
const heatmapOption = computed<EChartsOption>(() => buildHeatmapOption(heatmapCells.value));

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

function formatShortTime(value: string) {
  return new Date(value).toLocaleString('zh-CN', { hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function baseTooltip() {
  return {
    backgroundColor: 'rgba(21, 15, 35, 0.96)',
    borderColor: 'rgba(194, 239, 78, 0.28)',
    textStyle: { color: '#ffffff' },
  };
}

function baseGrid() {
  return {
    top: 22,
    right: 18,
    bottom: 34,
    left: 54,
  };
}

function buildTotalTrendOption(items: TimeSeriesItem[]): EChartsOption {
  return {
    color: [ENTRY_COLORS.ws],
    grid: baseGrid(),
    tooltip: { trigger: 'axis', ...baseTooltip() },
    xAxis: {
      type: 'category',
      boundaryGap: false,
      data: items.map((item) => formatShortTime(item.timestamp)),
      axisLabel: chartAxisLabel,
      axisLine: { lineStyle: chartGridLine },
      axisTick: { show: false },
    },
    yAxis: {
      type: 'value',
      minInterval: 1,
      axisLabel: chartAxisLabel,
      splitLine: { lineStyle: chartGridLine },
    },
    series: [
      {
        name: 'connections',
        type: 'line',
        smooth: true,
        symbolSize: 7,
        data: items.map((item) => item.totalConnections),
        lineStyle: { width: 4 },
        areaStyle: { opacity: 0.16 },
      },
    ],
  };
}

function buildEntryTrendOption(items: TimeSeriesItem[]): EChartsOption {
  return {
    color: ENTRY_NAMES.map((name) => ENTRY_COLORS[name]),
    grid: baseGrid(),
    legend: {
      top: 0,
      right: 0,
      textStyle: chartTextStyle,
    },
    tooltip: { trigger: 'axis', ...baseTooltip() },
    xAxis: {
      type: 'category',
      boundaryGap: false,
      data: items.map((item) => formatShortTime(item.timestamp)),
      axisLabel: chartAxisLabel,
      axisLine: { lineStyle: chartGridLine },
      axisTick: { show: false },
    },
    yAxis: {
      type: 'value',
      minInterval: 1,
      axisLabel: chartAxisLabel,
      splitLine: { lineStyle: chartGridLine },
    },
    series: ENTRY_NAMES.map((name) => ({
      name,
      type: 'line',
      smooth: true,
      symbolSize: 5,
      data: items.map((item) => item.entries[name] ?? 0),
      lineStyle: { width: 3 },
    })),
  };
}

function buildEntryShareOption(current: SummaryResponse | null): EChartsOption {
  const entries = current?.entries ?? [];
  return {
    color: ENTRY_NAMES.map((name) => ENTRY_COLORS[name]),
    title: {
      text: formatNumber(totalEntryConnections.value),
      subtext: 'connections',
      left: 'center',
      top: 'center',
      textStyle: { color: '#ffffff', fontFamily: 'JetBrains Mono, ui-monospace, monospace', fontSize: 24 },
      subtextStyle: chartTextStyle,
    },
    tooltip: { trigger: 'item', ...baseTooltip() },
    legend: {
      bottom: 0,
      textStyle: chartTextStyle,
    },
    series: [
      {
        name: 'entry share',
        type: 'pie',
        radius: ['58%', '78%'],
        center: ['50%', '46%'],
        avoidLabelOverlap: true,
        label: { color: '#ffffff' },
        data: entries.map((entry) => ({
          name: entry.entryName,
          value: entry.connectionCount,
        })),
      },
    ],
  };
}

function buildEntryCompareOption(current: SummaryResponse | null): EChartsOption {
  const entries = current?.entries ?? [];
  return {
    color: [ENTRY_COLORS.ws],
    grid: { top: 22, right: 18, bottom: 34, left: 42 },
    tooltip: { trigger: 'axis', ...baseTooltip() },
    xAxis: {
      type: 'category',
      data: entries.map((entry) => entry.entryName),
      axisLabel: chartAxisLabel,
      axisLine: { lineStyle: chartGridLine },
      axisTick: { show: false },
    },
    yAxis: {
      type: 'value',
      minInterval: 1,
      axisLabel: chartAxisLabel,
      splitLine: { lineStyle: chartGridLine },
    },
    series: [
      {
        name: 'connections',
        type: 'bar',
        barWidth: 26,
        itemStyle: {
          borderRadius: [8, 8, 0, 0],
          color: (params: { dataIndex: number }) => ENTRY_COLORS[entries[params.dataIndex]?.entryName ?? 'ws'],
        },
        data: entries.map((entry) => entry.connectionCount),
      },
    ],
  };
}

function buildTopIpOption(current: SummaryResponse | null): EChartsOption {
  const items = current?.topIps.slice(0, 10) ?? [];
  return {
    color: ENTRY_NAMES.map((name) => ENTRY_COLORS[name]),
    grid: { top: 18, right: 24, bottom: 20, left: 118 },
    legend: {
      top: 0,
      right: 0,
      textStyle: chartTextStyle,
    },
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, ...baseTooltip() },
    xAxis: {
      type: 'value',
      minInterval: 1,
      axisLabel: chartAxisLabel,
      splitLine: { lineStyle: chartGridLine },
    },
    yAxis: {
      type: 'category',
      inverse: true,
      data: items.map((item) => item.ip),
      axisLabel: { ...chartAxisLabel, width: 104, overflow: 'truncate' },
      axisLine: { lineStyle: chartGridLine },
      axisTick: { show: false },
    },
    series: ENTRY_NAMES.map((name) => ({
      name,
      type: 'bar',
      stack: 'ip',
      barWidth: 14,
      data: items.map((item) => item.entryBreakdown[name] ?? 0),
    })),
  };
}

function buildHeatmapOption(cells: ReturnType<typeof buildHeatmap>): EChartsOption {
  const max = Math.max(1, ...cells.map((cell) => cell.value));
  return {
    tooltip: {
      position: 'top',
      formatter: (params: unknown) => formatHeatmapTooltip(params, cells),
      ...baseTooltip(),
    },
    grid: { top: 12, right: 16, bottom: 42, left: 18 },
    xAxis: {
      type: 'category',
      data: cells.map((cell) => formatShortTime(cell.timestamp)),
      axisLabel: { ...chartAxisLabel, interval: 'auto' },
      axisLine: { show: false },
      axisTick: { show: false },
    },
    yAxis: {
      type: 'category',
      data: [''],
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { show: false },
    },
    visualMap: {
      min: 0,
      max,
      show: false,
      inRange: {
        color: ['rgba(194, 239, 78, 0.12)', '#c2ef4e'],
      },
    },
    series: [
      {
        name: 'activity',
        type: 'heatmap',
        data: cells.map((cell, index) => [index, 0, cell.value]),
        label: { show: false },
        itemStyle: {
          borderRadius: 6,
          borderWidth: 2,
          borderColor: 'rgba(21, 15, 35, 0.9)',
        },
      },
    ],
  };
}

function formatHeatmapTooltip(params: unknown, cells: ReturnType<typeof buildHeatmap>) {
  const payload = Array.isArray(params) ? params[0] : params;
  const dataItem = (payload as { data?: unknown } | undefined)?.data;
  const index = Array.isArray(dataItem) && typeof dataItem[0] === 'number' ? dataItem[0] : -1;
  const cell = cells[index];
  return `${formatTime(cell?.timestamp)}<br/>connections: ${formatNumber(cell?.value ?? 0)}`;
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
          <VChart class="echart" :option="totalTrendOption" autoresize />
        </article>

        <article class="panel chart-panel wide">
          <div class="panel-heading">
            <div>
              <span class="panel-label">Entry Trend</span>
              <h2>分入口趋势</h2>
            </div>
          </div>
          <VChart class="echart" :option="entryTrendOption" autoresize />
        </article>

        <article class="panel">
          <div class="panel-heading">
            <div>
              <span class="panel-label">Entry Share</span>
              <h2>入口分布</h2>
            </div>
          </div>
          <VChart class="echart compact" :option="entryShareOption" autoresize />
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
          <VChart class="echart compact" :option="entryCompareOption" autoresize />
        </article>

        <article class="panel wide">
          <div class="panel-heading">
            <div>
              <span class="panel-label">Top 10 IP</span>
              <h2>高频来源排行</h2>
            </div>
          </div>
          <VChart class="echart top-chart" :option="topIpOption" autoresize />
          <div class="top-ip-list compact-list">
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
          <VChart class="echart heatmap-chart" :option="heatmapOption" autoresize />
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
