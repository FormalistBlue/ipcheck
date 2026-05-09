# ipcheck OpenResty reverse proxy

This records the phase 8 reverse-proxy deployment for `https://ipcheck.shandawang.cc`.

## Runtime location

- Main vhost: `/opt/1panel/apps/openresty/openresty/conf/conf.d/ipcheck.shandawang.cc.conf`
- Proxy include: `/opt/1panel/apps/openresty/openresty/www/sites/ipcheck.shandawang.cc/proxy/root.conf`
- Access log: `/opt/1panel/apps/openresty/openresty/www/sites/ipcheck.shandawang.cc/log/access.log`
- Error log: `/opt/1panel/apps/openresty/openresty/www/sites/ipcheck.shandawang.cc/log/error.log`
- Basic auth file: `/opt/1panel/apps/openresty/openresty/www/sites/ipcheck.shandawang.cc/auth_basic/auth.pass`
- TLS files: `/opt/1panel/apps/openresty/openresty/www/sites/ipcheck.shandawang.cc/ssl/fullchain.pem` and `privkey.pem`

The repository only stores non-secret config templates. Do not commit TLS private keys or auth files.

## Current behavior

- Cloudflare DNS for `ipcheck.shandawang.cc` resolves to Cloudflare proxy IPs, confirming orange-cloud/proxied traffic.
- The origin vhost binds explicitly to `10.0.0.3:80` and `10.0.0.3:443 ssl http2`, matching the main OpenResty entry IP.
- HTTP redirects to HTTPS.
- HTTPS uses the existing Cloudflare Origin wildcard certificate copied into the site ssl directory.
- Basic auth is enabled before the dashboard, reusing the existing server-side auth file pattern used by admin dashboards.
- Upstream proxy target is `http://127.0.0.1:8788`.
- 1Panel WAF `sites.json` includes `ipcheck.shandawang.cc` to avoid unknown-site blocking.

## Verify

```bash
sudo docker exec 1Panel-openresty-yP5p /usr/local/openresty/bin/openresty -t
sudo docker exec 1Panel-openresty-yP5p /usr/local/openresty/bin/openresty -s reload
curl -sS -I https://ipcheck.shandawang.cc
curl -sS -i https://ipcheck.shandawang.cc/api/health | head
curl -sS http://127.0.0.1:8788/api/health
```

Unauthenticated public requests should return `401` from Basic Auth. With valid Basic Auth credentials, `/api/health` returns the ipcheck API health JSON and `/` returns the Vue dashboard HTML.
