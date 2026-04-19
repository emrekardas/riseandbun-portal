# Coolify Deployment Guide

Production deployment for the Rise & Bun KDS portal.

## Build pipeline at a glance

| Stage | What | Output size |
|---|---|---|
| `deps` | `npm ci` (Alpine + libc6-compat) | ~250MB layer |
| `builder` | `npm run build` → `.next/standalone` | ~38MB |
| `runner` | Copy standalone + non-root user + healthcheck | **~90MB final image** |

Multi-stage Dockerfile. Alpine base. Non-root `nextjs` user. tini as PID 1.

## Coolify application settings

### General

| Field | Value |
|---|---|
| **Build Pack** | `dockerfile` |
| **Dockerfile Location** | `./Dockerfile` |
| **Port** | `3000` |
| **Domains** | `https://portal.riseandbun.co.uk` |
| **HTTPS** | enabled (Let's Encrypt) |
| **Force HTTPS Redirect** | yes |

### Resources

| Field | Value | Why |
|---|---|---|
| **Memory Limit** | `512MB` | Node heap is capped at 384MB via `NODE_OPTIONS`; +128MB headroom for V8 scratch + libc + SSE buffers |
| **CPU Limit** | `1.0` (1 core) | Single tablet workload, plenty |
| **Restart Policy** | `unless-stopped` | Coolify default |

### Persistent Storage

Square OAuth tokens are encrypted (AES-256-GCM) and stored on disk. Without
a persistent volume, every redeploy disconnects Square and forces a manual
re-auth in the dashboard.

| Field | Value |
|---|---|
| **Source Path** | `square-token-data` (Coolify-managed named volume) |
| **Destination Path** | `/data` |

The `DATA_DIR=/data` env var is already set in the Dockerfile, so the app
writes `/data/square-token.json` automatically.

### Health Check

Coolify auto-detects the `HEALTHCHECK` directive in the Dockerfile.
No manual configuration needed. Endpoint: `GET /api/health`.

If you want to override:

| Field | Value |
|---|---|
| **Path** | `/api/health` |
| **Port** | `3000` |
| **Interval** | `30s` |
| **Timeout** | `5s` |
| **Start Period** | `20s` |
| **Retries** | `3` |

## Environment variables

Copy these into Coolify → Environment Variables. **All are runtime-only**
(no `NEXT_PUBLIC_*` vars in this project, so no build-time arg setup needed).

### Required

```bash
# Square OAuth — production app credentials
SQUARE_APPLICATION_ID=sq0idp-Fnvt1TO18dt_6wMwIoUhFw
SQUARE_APPLICATION_SECRET=sq0csp-...                           # rotate if leaked
SQUARE_ENVIRONMENT=production
SQUARE_API_VERSION=2026-01-22
SQUARE_OAUTH_REDIRECT_URI=https://portal.riseandbun.co.uk/api/square/oauth/callback

# Portal authentication
PORTAL_PASSWORD=<choose a strong password>
AUTH_SECRET=<at least 32 random chars — used to sign sessions AND encrypt the Square token>

# Mock mode OFF in prod
MOCK_ORDERS=0
```

> **AUTH_SECRET is critical** — if it changes between deploys, the encrypted
> Square token on disk becomes unreadable and you have to re-auth. Generate
> once with `openssl rand -base64 48` and keep it safe.

### Optional (Square Webhooks — for instant order push)

Skip these for the first deploy; the 2-second background poller already
keeps the SSE stream warm. Add them later for sub-200ms push from Square.

```bash
SQUARE_WEBHOOK_URL=https://portal.riseandbun.co.uk/api/webhooks/square
SQUARE_WEBHOOK_SIGNATURE_KEY=<from Square Dashboard → Webhooks → Subscriptions>
```

The URL **must match character-for-character** what you registered in Square,
otherwise the HMAC signature will not validate.

## Square Dashboard one-time setup

After the first successful deploy:

1. **OAuth redirect URL** — Square Dashboard → your app → OAuth → Production tab → Redirect URL must be exactly `https://portal.riseandbun.co.uk/api/square/oauth/callback`. Save.
2. **Visit the portal**, click "Connect to Square", authorize. Token is
   encrypted and persisted to `/data/square-token.json`.
3. **Optional — Webhooks** (for sub-200ms order push):
   - Square Dashboard → Webhooks → Subscriptions → Add Subscription
   - Name: `KDS Portal`
   - API version: `2026-01-22`
   - URL: `https://portal.riseandbun.co.uk/api/webhooks/square`
   - Events: `order.created`, `order.updated`, `order.fulfillment.updated`
   - Save → copy the Signature Key → paste into Coolify env → Restart

## Post-deploy verification

Run these from your laptop after the first deploy:

```bash
# 1. Health endpoint reachable, no auth needed
curl -i https://portal.riseandbun.co.uk/api/health
# → 200 OK with {"status":"ok","uptime":...}

# 2. robots.txt blocks all crawlers
curl https://portal.riseandbun.co.uk/robots.txt
# → User-Agent: * / Disallow: /

# 3. Every response has noindex header
curl -I https://portal.riseandbun.co.uk/login | grep -i x-robots
# → x-robots-tag: noindex, nofollow, ...

# 4. Webhook endpoint exists (returns 500 not_configured if env not set,
#    or 403 invalid_signature on a random body — both prove it's wired up)
curl -X POST https://portal.riseandbun.co.uk/api/webhooks/square -d '{}'

# 5. SSE stream stays open and emits a snapshot
curl -N https://portal.riseandbun.co.uk/api/orders/stream \
  -H "Cookie: <copy from browser devtools after logging in>" \
  --max-time 8
# → "data: {\"type\":\"snapshot\",\"orders\":[...]}"
```

## What to monitor in Coolify after deploy

| Metric | Healthy range | Action if exceeded |
|---|---|---|
| **Memory** | <300MB steady | If creeps past 400MB, check SSE subscriber count for leaks |
| **CPU** | <10% idle, <40% under load | Single-digit at idle is normal |
| **Restarts** | 0 in 24h | Investigate logs; OOM killed → bump memory or fix leak |
| **Health check** | green | Red → check `/api/health` directly via shell exec |

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Square disconnects after every redeploy | Volume not mounted | Check `/data` is a persistent volume, not anonymous |
| OAuth callback returns "AUTH_SECRET is required" | Env not set | Add `AUTH_SECRET` in Coolify, redeploy |
| Webhook always returns 403 | URL mismatch or wrong key | `SQUARE_WEBHOOK_URL` must equal Dashboard URL byte-for-byte |
| Health check failing on first start | App needs more boot time | Bump `--start-period` in Dockerfile HEALTHCHECK |
| Tablet shows "Not connected" | OAuth flow incomplete | Click "Connect to Square" in the header → authorize |
| Container OOM-killed | Memory limit too tight or actual leak | First raise to 768MB; if still happens, bisect SSE handler |
| `/api/orders/stream` disconnects every 30-60s | Reverse proxy idle timeout | Coolify/Traefik default is fine; if behind Cloudflare, the SSE keep-alive ping every 25s handles it |

## File ownership reference

```
.
├── Dockerfile              # multi-stage build → ~90MB Alpine image
├── .dockerignore           # excludes .git, .env, .data, tests, etc.
├── next.config.ts          # output: "standalone" — required by Dockerfile
├── app/api/health/route.ts # liveness probe for HEALTHCHECK
├── proxy.ts                # auth + X-Robots-Tag on every response
└── lib/square/token-store.ts  # writes encrypted token to $DATA_DIR
```
