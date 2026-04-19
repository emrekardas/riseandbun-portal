import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Lightweight liveness probe for Docker HEALTHCHECK and Coolify.
 *
 * Intentionally does NOT call Square or read any file — health checks
 * must be fast and side-effect free. If this endpoint can serve a
 * response, the Node process is alive and the HTTP listener is up.
 */
export async function GET() {
  return NextResponse.json(
    {
      status: "ok",
      uptime: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    },
    {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate",
        "X-Robots-Tag": "noindex, nofollow",
      },
    },
  );
}
