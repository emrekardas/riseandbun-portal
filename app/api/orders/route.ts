import { NextResponse } from "next/server";
import { getTodayOrders, type SquareOrder } from "@/lib/square/orders";
import { SquareApiError, SquareNotConnectedError } from "@/lib/square/client";
import { isMockMode } from "@/lib/mock/config";
import { getMockOrders } from "@/lib/mock/orders-store";
import { isDrink } from "@/lib/menu/drinks";
import { ensureCacheStarted } from "@/lib/realtime/orders-cache";

function orderHasDrink(order: SquareOrder): boolean {
  return (order.line_items ?? []).some((li) => isDrink(li.name));
}

function filterOrdersForKds(orders: SquareOrder[]): {
  visible: SquareOrder[];
  filteredOut: number;
} {
  const visible: SquareOrder[] = [];
  let filteredOut = 0;
  for (const order of orders) {
    if (orderHasDrink(order)) {
      visible.push(order);
    } else {
      filteredOut += 1;
    }
  }
  return { visible, filteredOut };
}

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
    const all = getMockOrders();
    const { visible, filteredOut } = filterOrdersForKds(all);
    return NextResponse.json(
      {
        orders: visible,
        fetchedAt: new Date().toISOString(),
        mock: true,
        filteredOut,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const all = await getTodayOrders();
    const { visible, filteredOut } = filterOrdersForKds(all);
    return NextResponse.json(
      {
        orders: visible,
        fetchedAt: new Date().toISOString(),
        filteredOut,
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
