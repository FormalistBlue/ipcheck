# ipcheck

Xray WebSocket Real IP Dashboard for ws/ws1/ws2/ws3 traffic.

ipcheck reads OpenResty access logs, extracts successful WebSocket connections, stores aggregated snapshots in SQLite, and displays the data through a Vue + ECharts dashboard.

## Planned Stack

- Frontend: Vue 3 + Vite + TypeScript
- Charts: ECharts
- Backend: Node.js + Fastify + TypeScript
- Database: SQLite
- Scheduler: systemd timer every 10 minutes
- Deployment: local API service behind 1Panel/OpenResty reverse proxy

## Target Deployment

- Project path: `/home/ubuntu/personal/workSpace/ipcheck`
- Domain: `https://xc.shandawang.cc`
- Local API port: `127.0.0.1:8788`
- Access protection: 1Panel/OpenResty reverse proxy password before public use

## Documents

- `产品设计文档.md`
- `开发步骤清单.md`

## Security Notes

The dashboard shows full client IP addresses. Keep the app behind reverse-proxy authentication before sharing the public domain.

Do not commit runtime databases, logs, `.env` files, or raw access logs.
