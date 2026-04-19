# syntax=docker/dockerfile:1.7

# ─────────────────────────────────────────────────────────────────────
# Stage 1 — install dependencies (cacheable layer)
# ─────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS deps
WORKDIR /app

# Alpine needs libc6-compat for some Next.js native bindings
RUN apk add --no-cache libc6-compat

COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund

# ─────────────────────────────────────────────────────────────────────
# Stage 2 — build the Next.js app (produces .next/standalone)
# ─────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN npm run build

# ─────────────────────────────────────────────────────────────────────
# Stage 3 — runtime (tiny image, no build tools, non-root)
# ─────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Cap V8 heap so a runaway allocation can't OOM-kill the container
# Default ~1.5GB on x64; pin to 384MB for a small KDS workload
ENV NODE_OPTIONS="--max-old-space-size=384"

# Persistent data dir for the encrypted Square OAuth token
# Mount a Coolify volume here: /data → DATA_DIR
ENV DATA_DIR=/data

RUN apk add --no-cache wget tini \
  && addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs \
  && mkdir -p /data \
  && chown -R nextjs:nodejs /data

# Standalone output ships its own minimal node_modules already pruned
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

USER nextjs

EXPOSE 3000

# tini reaps zombie processes properly so SSE long-lived connections
# don't leak file descriptors when they disconnect
ENTRYPOINT ["/sbin/tini", "--"]

# Liveness probe — fast, side-effect free
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1

CMD ["node", "server.js"]
