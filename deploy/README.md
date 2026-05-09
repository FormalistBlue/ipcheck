# ipcheck systemd deployment

This directory contains the systemd units used for the production deployment on the current server.

## Runtime paths

- Node executable: `/home/ubuntu/.nvm/versions/node/v24.14.1/bin/node`
- Project: `/home/ubuntu/personal/workSpace/ipcheck`
- SQLite database: `/var/lib/ipcheck/ipcheck.db`
- Optional app logs: `/var/log/ipcheck`
- API bind address: `127.0.0.1:8788`
- Frontend static files: `apps/web/dist`

## Install or update

Run from the repository root:

```bash
pnpm build
sudo mkdir -p /var/lib/ipcheck /var/log/ipcheck
sudo chown ubuntu:ubuntu /var/lib/ipcheck /var/log/ipcheck
sudo chmod 700 /var/lib/ipcheck /var/log/ipcheck
sudo install -m 0644 deploy/systemd/ipcheck-api.service /etc/systemd/system/ipcheck-api.service
sudo install -m 0644 deploy/systemd/ipcheck-collector.service /etc/systemd/system/ipcheck-collector.service
sudo install -m 0644 deploy/systemd/ipcheck-collector.timer /etc/systemd/system/ipcheck-collector.timer
sudo systemctl daemon-reload
sudo systemctl enable --now ipcheck-api.service
sudo systemctl restart ipcheck-api.service
sudo systemctl enable --now ipcheck-collector.timer
sudo systemctl start ipcheck-collector.service
sudo chmod 600 /var/lib/ipcheck/ipcheck.db*
```

## Verify

```bash
systemctl status ipcheck-api --no-pager
systemctl list-timers 'ipcheck-*' --no-pager
journalctl -u ipcheck-collector.service -n 80 --no-pager
ss -ltnp | grep ':8788'
curl -sS http://127.0.0.1:8788/api/health
curl -sS 'http://127.0.0.1:8788/api/summary?range=7d'
sudo sqlite3 /var/lib/ipcheck/ipcheck.db 'SELECT COUNT(*) FROM snapshots; SELECT COUNT(*) FROM collection_runs;'
```

The collector timer runs every 10 minutes. A manual `systemctl start ipcheck-collector.service` is safe and creates one immediate set of snapshots for all configured ranges.

## Maintenance notes

The systemd units use the exact Node executable installed by nvm. After upgrading Node, update `ExecStart=` in both unit files, reinstall them, run `sudo systemctl daemon-reload`, and restart the API.

The SQLite database contains client IP addresses. Keep `/var/lib/ipcheck`, `/var/log/ipcheck`, and `/var/lib/ipcheck/ipcheck.db*` readable only by the `ubuntu` user.
