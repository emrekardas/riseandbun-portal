import { NextResponse } from "next/server";
import { getTodayOrders } from "@/lib/square/orders";
import { SquareApiError, SquareNotConnectedError } from "@/lib/square/client";
import { markFoodLineItems } from "@/lib/square/food-items";
import { isMockMode } from "@/lib/mock/config";
import { getMockOrders } from "@/lib/mock/orders-store";
import { ensureCacheStarted } from "@/lib/realtime/orders-cache";

export async function GET() {
  // Always try to read from cache first (zero-latency, in-memory).
  // Cache is kept warm by the background poller and the SSE stream.
  const cache = ensureCacheStarted();
  const cacheStatus = cache.status();

  if (cacheStatus.ready) {
    return NextResponse.json(
      {
        orders: cache.snapshot(),
        fetchedAt: cacheStatus.lastFetchedAt,
        mock: isMockMode(),
        cached: true,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  // Cache not warm yet — do a one-shot fetch so the first paint isn't empty.
  if (isMockMode()) {
    return NextResponse.json(
      {
        orders: getMockOrders(),
        fetchedAt: new Date().toISOString(),
        mock: true,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const orders = await markFoodLineItems(await getTodayOrders());
    return NextResponse.json(
      {
        orders,
        fetchedAt: new Date().toISOString(),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof SquareNotConnectedError) {
      return NextResponse.json(
        { error: "not_connected" },
        { status: 409, headers: { "Cache-Control": "no-store" } },
      );
    }
    if (error instanceof SquareApiError) {
      return NextResponse.json(
        { error: "square_api_error", status: error.status, body: error.body },
        { status: 502 },
      );
    }
    const message =
      error instanceof Error ? error.message : "unknown_error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
