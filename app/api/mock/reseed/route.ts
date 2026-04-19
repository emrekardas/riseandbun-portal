import { NextResponse } from "next/server";
import { isMockMode } from "@/lib/mock/config";
import { reseedMockOrders } from "@/lib/mock/orders-store";

export async function POST() {
  if (!isMockMode()) {
    return NextResponse.json(
      { error: "mock_mode_disabled" },
      { status: 404 },
    );
  }
  const orders = reseedMockOrders();
  return NextResponse.json(
    { orders },
    { headers: { "Cache-Control": "no-store" } },
  );
}
