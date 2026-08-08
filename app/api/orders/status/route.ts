import { NextResponse } from "next/server";
import {
  clearAllStatuses,
  setOrderStatus,
} from "@/lib/orders/server-status-store";
import { recordServed } from "@/lib/orders/stats-store";
import { getOrdersCache } from "@/lib/realtime/orders-cache";
import { tenantFromRequest } from "@/lib/tenants";
import type { OrderStatus } from "@/lib/orders/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_STATUSES: readonly OrderStatus[] = [
  "pending",
  "in_progress",
  "ready",
  "completed",
];

function isOrderStatus(value: unknown): value is OrderStatus {
  return (
    typeof value === "string" &&
    (VALID_STATUSES as readonly string[]).includes(value)
  );
}

/**
 * Set an order's status. Authoritative on the server: persists to disk and
 * broadcasts to every connected tablet over the SSE stream.
 *
 * Auth is enforced upstream by `proxy.ts` (this path is not public) — an
 * unauthenticated request gets a 401 before reaching here.
 */
export async function POST(request: Request) {
  const tenant = tenantFromRequest(request);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "bad_json" }, { status: 400 });
  }

  const orderId =
    body && typeof body === "object" && "orderId" in body
      ? (body as { orderId: unknown }).orderId
      : undefined;
  const status =
    body && typeof body === "object" && "status" in body
      ? (body as { status: unknown }).status
      : undefined;

  if (typeof orderId !== "string" || !orderId || !isOrderStatus(status)) {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }

  const entry = await setOrderStatus(tenant, orderId, status);

  // First time an order reaches "ready" = drink made / served at the bar.
  // Record it for the daily throughput / on-time stats (idempotent).
  if (status === "ready") {
    const bodyCreatedAt =
      body && typeof body === "object" && "createdAt" in body
        ? (body as { createdAt: unknown }).createdAt
        : undefined;
    // Prefer the createdAt the client already has; fall back to the cache.
    const createdAt =
      typeof bodyCreatedAt === "string" && bodyCreatedAt
        ? bodyCreatedAt
        : getOrdersCache(tenant)
            .snapshot()
            .find((o) => o.id === orderId)?.created_at;
    if (createdAt) {
      const prepMs = Date.now() - new Date(createdAt).getTime();
      await recordServed(tenant, orderId, prepMs);
    }
  }

  return NextResponse.json(
    { ok: true, orderId, ...entry },
    { headers: { "Cache-Control": "no-store" } },
  );
}

/** Clear all order statuses (manual reset / mock reseed). */
export async function DELETE(request: Request) {
  await clearAllStatuses(tenantFromRequest(request));
  return NextResponse.json(
    { ok: true },
    { headers: { "Cache-Control": "no-store" } },
  );
}
