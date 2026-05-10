# ipcheck

Xray WebSocket real-IP dashboard for `ws` / `ws1` / `ws2` / `ws3` traffic.

`ipcheck` reads OpenResty access logs, extracts successful WebSocket upgrade requests, aggregates the results into SQLite snapshots, and exposes them through a Fastify API plus a Vue + ECharts dashboard.

## What is finished

- Vue 3 + Vite dashboard with range switching, auto refresh, trends, entry breakdowns, TOP IP ranking, heatmap, latest snapshot, and recent collector runs
- Fastify API for summary, timeseries, top IPs, recent snapshots, and recent collector runs
- SQLite persistence with 180-day retention cleanup
- Collector that reads four OpenResty access logs every 10 minutes
- systemd deployment for the API service and collector timer
- OpenResty + Cloudflare reverse proxy template for `https://ipcheck.shandawang.cc`
- Basic Auth protection at the reverse-proxy layer before exposing the dashboard publicly

## Repository layout

- `apps/web` - Vue dashboard
- `apps/api` - Fastify API, SQLite layer, collector CLI, and tests
- `packages/shared` - shared TypeScript types
- `deploy/systemd` - production systemd units
- `deploy/openresty` - non-secret reverse proxy config templates
- `产品设计文档.md` - product/design notes
- `开发步骤清单.md` - execution checklist and progress log

## Stack

- Frontend: Vue 3 + Vite + TypeScript + ECharts
- Backend: Node.js + Fastify + TypeScript
- Database: SQLite (`better-sqlite3`)
- Scheduler: systemd timer every 10 minutes
- Deployment: local API service behind 1Panel/OpenResty reverse proxy

## Local development

Requirements:

- Node.js >= 22
- pnpm >= 10

Install and run:

```bash
pnpm install
pnpm dev
```

Other useful commands:

```bash
pnpm build
pnpm typecheck
pnpm --filter api test
pnpm --filter api collect -- --dry-run
```

Defaults:

- API bind address: `127.0.0.1:8788`
- Default SQLite path: `/var/lib/ipcheck/ipcheck.db`
- Static dashboard build output: `apps/web/dist`
- CORS is disabled by default; set `IPCHECK_CORS_ORIGIN` only if you need cross-origin API access

For local API development without writing to `/var/lib`, override the DB path:

```bash
IPCHECK_DB_PATH=/tmp/ipcheck-dev.db pnpm --filter api dev
```

## API overview

Main endpoints:

- `GET /api/health`
- `GET /api/summary?range=30m|24h|7d|30d|90d`
- `GET /api/timeseries?range=...&bucket=10m|1h|1d`
- `GET /api/top-ips?range=...&limit=10|20|50`
- `GET /api/entries?range=...`
- `GET /api/snapshots/recent?range=...&limit=1..100`
- `GET /api/runs/recent?limit=1..100`

## Collector behavior

The collector reads these OpenResty logs by default:

- `/opt/1panel/apps/openresty/openresty/www/sites/ws.shandawang.cc/log/access.log`
- `/opt/1panel/apps/openresty/openresty/www/sites/ws1.shandawang.cc/log/access.log`
- `/opt/1panel/apps/openresty/openresty/www/sites/ws2.shandawang.cc/log/access.log`
- `/opt/1panel/apps/openresty/openresty/www/sites/ws3.shandawang.cc/log/access.log`

Rules:

- Only successful WebSocket upgrade lines with status `101` are counted
- Real client IP is read from the final `X-Forwarded-For` field in each log line
- Snapshot windows: `30m`, `24h`, `7d`, `30d`, `90d`
- Old snapshots older than 180 days are deleted during persisted collection runs
- Snapshot windows are bounded by the collector run time; future-dated log lines are excluded from each window
- Long-window accuracy depends on log retention in the source files; rotated logs are not yet merged into collection

Dry-run example:

```bash
pnpm --filter api collect -- --dry-run --tail-lines 5000
```

## Production deployment

Current target deployment:

- Project path: `/home/ubuntu/personal/workSpace/ipcheck`
- Public domain: `https://ipcheck.shandawang.cc`
- Local upstream: `http://127.0.0.1:8788`
- Public protection: OpenResty Basic Auth in front of the app

Deployment details live in:

- `deploy/README.md`
- `deploy/systemd/ipcheck-api.service`
- `deploy/systemd/ipcheck-collector.service`
- `deploy/systemd/ipcheck-collector.timer`
- `deploy/openresty/README.md`

Typical update flow:

```bash
pnpm build
sudo install -m 0644 deploy/systemd/ipcheck-api.service /etc/systemd/system/ipcheck-api.service
sudo install -m 0644 deploy/systemd/ipcheck-collector.service /etc/systemd/system/ipcheck-collector.service
sudo install -m 0644 deploy/systemd/ipcheck-collector.timer /etc/systemd/system/ipcheck-collector.timer
sudo systemctl daemon-reload
sudo systemctl restart ipcheck-api.service
sudo systemctl restart ipcheck-collector.timer
```

## Verification checklist

Useful checks:

```bash
pnpm build
pnpm typecheck
pnpm --filter api test
curl -sS http://127.0.0.1:8788/api/health
systemctl status ipcheck-api --no-pager
systemctl list-timers 'ipcheck-*' --no-pager
journalctl -u ipcheck-collector.service -n 80 --no-pager
```

Phase 9 validation on the current server confirmed:

- all five ranges (`30m`, `24h`, `7d`, `30d`, `90d`) return data from the live API
- collector timer is active and a manual collector run writes fresh snapshots and collection runs
- 180-day cleanup behavior is covered by automated tests in `apps/api/src/db.test.ts`
- unauthenticated public access to `https://ipcheck.shandawang.cc` returns `401` from Basic Auth
- `git ls-files` shows no committed `.env`, database, log, TLS key, or auth files

## Security notes

- The dashboard shows full client IP addresses
- Keep the public domain behind reverse-proxy authentication or Cloudflare Access
- Do not commit runtime databases, logs, `.env` files, TLS private keys, auth files, or raw access logs
- Keep `/var/lib/ipcheck`, `/var/log/ipcheck`, and SQLite files readable only by the service user
