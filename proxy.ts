import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  SESSION_COOKIE_NAME,
  verifySessionToken,
} from "@/lib/auth/session";

const PUBLIC_PATHS = new Set(["/login"]);
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

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (PUBLIC_PATHS.has(pathname) || PUBLIC_API_PATHS.has(pathname)) {
    return withRobots(NextResponse.next());
  }

  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const isAuthenticated = verifySessionToken(token);

  if (isAuthenticated) {
    return withRobots(NextResponse.next());
  }

  if (pathname.startsWith("/api/")) {
    return withRobots(
      NextResponse.json({ error: "unauthorized" }, { status: 401 }),
    );
  }

  const loginUrl = new URL("/login", request.url);
  if (pathname !== "/") {
    loginUrl.searchParams.set("next", pathname);
  }
  return withRobots(NextResponse.redirect(loginUrl));
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|site.webmanifest|browserconfig.xml|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
