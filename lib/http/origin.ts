import "server-only";
import type { NextRequest } from "next/server";

/**
 * Resolve the public-facing origin (scheme + host) for a request.
 *
 * Behind a reverse proxy (Traefik, Caddy, Nginx) `request.url` reports the
 * internal address (e.g. `0.0.0.0:3000`). Production redirects must use the
 * canonical hostname instead, which is forwarded via standard proxy headers.
 *
 * Resolution order:
 *   1. `Forwarded` header (RFC 7239)
 *   2. `X-Forwarded-Proto` + `X-Forwarded-Host`
 *   3. `Host` header (assumed https in production, http in dev)
 *   4. `SQUARE_OAUTH_REDIRECT_URI` env (last-ditch fallback so we never
 *      accidentally leak the internal address).
 *   5. `request.url`
 */
export function getPublicOrigin(request: NextRequest | Request): string {
  const headers = request.headers;

  const forwarded = headers.get("forwarded");
  if (forwarded) {
    const parsed = parseForwardedHeader(forwarded);
    if (parsed) return parsed;
  }

  const proto =
    headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ||
    headers.get("x-forwarded-protocol")?.split(",")[0]?.trim();

  const host =
    headers.get("x-forwarded-host")?.split(",")[0]?.trim() ||
    headers.get("host");

  if (host && !isInternalHost(host)) {
    const scheme = proto || (process.env.NODE_ENV === "production" ? "https" : "http");
    return `${scheme}://${host}`;
  }

  const envRedirect = process.env.SQUARE_OAUTH_REDIRECT_URI;
  if (envRedirect) {
    try {
      return new URL(envRedirect).origin;
    } catch {
      // fall through
    }
  }

  return new URL(request.url).origin;
}

/**
 * Build a URL anchored on the public origin instead of the internal one.
 */
export function publicUrl(
  request: NextRequest | Request,
  pathname: string,
): URL {
  return new URL(pathname, getPublicOrigin(request));
}

function parseForwardedHeader(value: string): string | null {
  const first = value.split(",")[0];
  if (!first) return null;

  let proto: string | undefined;
  let host: string | undefined;

  for (const part of first.split(";")) {
    const [rawKey, ...rawValParts] = part.trim().split("=");
    if (!rawKey || rawValParts.length === 0) continue;
    const key = rawKey.toLowerCase();
    const val = rawValParts.join("=").trim().replace(/^"|"$/g, "");
    if (key === "proto") proto = val;
    else if (key === "host") host = val;
  }

  if (host && !isInternalHost(host)) {
    const scheme = proto || (process.env.NODE_ENV === "production" ? "https" : "http");
    return `${scheme}://${host}`;
  }
  return null;
}

function isInternalHost(host: string): boolean {
  const lowered = host.toLowerCase();
  return (
    lowered.startsWith("0.0.0.0") ||
    lowered.startsWith("127.") ||
    lowered.startsWith("localhost") ||
    lowered.startsWith("[::1]") ||
    lowered.startsWith("::1")
  );
}
