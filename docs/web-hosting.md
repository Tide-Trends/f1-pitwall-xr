# Web hosting (f1.lukaah.com + Quest)

PitWall XR is a web app at its core. The Mac **Electron** shell is only required for F1 TV login (Imperva) and **live Widevine DRM**. Replay and the full UI can run from a public HTTPS URL.

## Vercel (client UI)

The repo includes `vercel.json` at the monorepo root. Vercel builds **only the React client** (`apps/client/dist`).

```bash
# From repo root (logged in: vercel whoami)
vercel --prod
```

**Project settings (Vercel dashboard):**

| Setting | Value |
|---------|--------|
| Root Directory | `.` (repo root) |
| Build Command | `pnpm install && pnpm --filter @pitwall/client build` |
| Output Directory | `apps/client/dist` |
| Install Command | `pnpm install` |

**Environment variables:**

| Name | Example | Purpose |
|------|---------|---------|
| `VITE_API_BASE` | `https://api.f1.lukaah.com/api` | Backend URL when API is not same-origin |

Without `VITE_API_BASE`, the client calls `/api` on the same host — only works if you also proxy API traffic (see nginx below) or run API on the same domain via a second service.

**Custom domain:** Add `f1.lukaah.com` in Vercel → Domains. Point DNS:

- `CNAME` `f1` → `cname.vercel-dns.com` (or the target Vercel shows)

Vercel does **not** run the Express server or WebSockets. You still need API hosting (below).

## Recommended full setup

| Role | Host | Notes |
|------|------|--------|
| Web UI | `https://f1.lukaah.com` | Static Vite build or reverse-proxy to dev server |
| API + WS | `https://f1.lukaah.com/api` | Express on `:8787`, proxied same-origin |
| Mac desktop | Electron | Auth once; tokens persist on server |
| Quest 2 | Quest Browser → `https://f1.lukaah.com` | Same Wi‑Fi or public URL; WebXR for spatial mode |

Same-origin proxy avoids CORS and keeps cookies/tokens on your server.

## Build & deploy

```bash
cd f1-pitwall-xr
pnpm build
# client: apps/client/dist
# server: apps/server/dist
```

Example nginx (simplified):

```nginx
server {
  listen 443 ssl http2;
  server_name f1.lukaah.com;

  location / {
    root /var/www/pitwall/client/dist;
    try_files $uri /index.html;
  }

  location /api/ {
    proxy_pass https://127.0.0.1:8787/api/;
    proxy_ssl_verify off;
  }

  location /ws/ {
    proxy_pass https://127.0.0.1:8787/ws/;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_ssl_verify off;
  }
}
```

Run the API with persisted tokens (`apps/data/tokens.json`) on the host. After signing in once from the Mac app, Quest clients can use replay and spatial mode against the same backend.

## Client env (optional)

For a split API host, set at build time:

```bash
VITE_API_BASE=https://f1.lukaah.com/api pnpm --filter @pitwall/client build
```

When unset, the client uses `/api` (Vite dev proxy or nginx).

## Quest limits

- Live DRM streams still need castLabs Electron on Mac.
- Quest hardware decodes ~1–2 streams; use spatial mode stream swapping.
- WebXR requires HTTPS (not `http://` LAN unless using mkcert on device).

## Auth flow for web-only users

1. Sign in on Mac via Electron (once).
2. Server stores tokens in `apps/data/tokens.json`.
3. Quest opens `https://f1.lukaah.com` — no login UI needed if server session is valid.

Future: token handoff QR or short-lived session link for Quest-only setups.
