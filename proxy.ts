import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  SESSION_COOKIE_NAME,
  verifySessionToken,
} from "@/lib/auth/session";
import { isTenantId, TENANT_HEADER, type TenantId } from "@/lib/tenants";

/**
 * Root is the single login screen — the password itself decides which
 * tenant you land on (see app/api/auth/login). Tenant areas live under
 * /<tenant> and are path-scoped: the session cookie is set with
 * Path=/<tenant> and its signature is bound to the tenant, so a Margate
 * session can never open Soho.
 */
const PUBLIC_PATHS = new Set(["/", "/login"]);
const PUBLIC_API_PATHS = new Set([
  "/api/auth/login",
  "/api/health",
  "/api/webhooks/square",
]);

/**
 * Block ALL search engines, AI crawlers and previewers from indexing
 * this private staff portal. Applied to every response (HTML, JSON,
 * redirects) so a crawler that ignores robots.txt still sees noindex.
 *
 * Layered with `app/robots.ts` and `metadata.robots` in `app/layout.tsx`.
 */
const ROBOTS_DIRECTIVE =
  "noindex, nofollow, noarchive, nosnippet, noimageindex, notranslate";

function withRobots(response: NextResponse): NextResponse {
  response.headers.set("X-Robots-Tag", ROBOTS_DIRECTIVE);
  return response;
}

/**
 * Behind a reverse proxy (Traefik) `request.url` reports the internal
 * container address (e.g. `0.0.0.0:3000`). Use the forwarded host so
 * redirects always land on the public hostname.
 */
function publicOriginFromRequest(request: NextRequest): string {
  const forwardedHost =
    request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() ||
    request.headers.get("host");
  const forwardedProto =
    request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ||
    (process.env.NODE_ENV === "production" ? "https" : "http");

  if (forwardedHost && !isInternalHost(forwardedHost)) {
    return `${forwardedProto}://${forwardedHost}`;
  }

  const envRedirect = process.env.SQUARE_OAUTH_REDIRECT_URI;
  if (envRedirect) {
    try {
      return new URL(envRedirect).origin;
    } catch {
      // ignore
    }
  }

  return new URL(request.url).origin;
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

/** Forward /<tenant>/<rest> to the internal route with the tenant header. */
function rewriteForTenant(
  request: NextRequest,
  tenant: TenantId,
  innerPath: string,
): NextResponse {
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(TENANT_HEADER, tenant);

  const url = request.nextUrl.clone();
  // The KDS board itself lives at /board; /<tenant> maps onto it.
  url.pathname = innerPath === "" || innerPath === "/" ? "/board" : innerPath;
  return withRobots(
    NextResponse.rewrite(url, { request: { headers: requestHeaders } }),
  );
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const firstSegment = pathname.split("/")[1];

  // ── Tenant area: /<tenant>/… ──────────────────────────────────────────
  if (isTenantId(firstSegment)) {
    const tenant = firstSegment;
    const innerPath = pathname.slice(tenant.length + 1); // "" or "/…"

    // Legacy tenant login URL → root login, which routes by password.
    if (innerPath === "/login") {
      const loginUrl = new URL("/", publicOriginFromRequest(request));
      loginUrl.searchParams.set("next", `/${tenant}`);
      return withRobots(NextResponse.redirect(loginUrl));
    }

    // A browser may carry multiple same-named cookies (legacy Path=/ plus
    // the tenant-scoped one) — accept the request if ANY of them is a valid
    // session for THIS tenant.
    const tokens = request.cookies
      .getAll(SESSION_COOKIE_NAME)
      .map((c) => c.value);
    const isAuthenticated = tokens.some((t) =>
      verifySessionToken(tenant, t),
    );

    if (!isAuthenticated) {
      if (innerPath.startsWith("/api/")) {
        return withRobots(
          NextResponse.json({ error: "unauthorized" }, { status: 401 }),
        );
      }
      const loginUrl = new URL("/", publicOriginFromRequest(request));
      loginUrl.searchParams.set("next", `/${tenant}`);
      return withRobots(NextResponse.redirect(loginUrl));
    }

    return rewriteForTenant(request, tenant, innerPath);
  }

  // ── Bare paths ─────────────────────────────────────────────────────────
  if (PUBLIC_PATHS.has(pathname) || PUBLIC_API_PATHS.has(pathname)) {
    return withRobots(NextResponse.next());
  }

  if (pathname.startsWith("/api/")) {
    return withRobots(
      NextResponse.json({ error: "unauthorized" }, { status: 401 }),
    );
  }

  // Anything else outside a tenant prefix → root login.
  const loginUrl = new URL("/", publicOriginFromRequest(request));
  return withRobots(NextResponse.redirect(loginUrl));
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|site.webmanifest|browserconfig.xml|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
