import { NextResponse } from "next/server";
import { clearToken } from "@/lib/square/token-store";
import { clearLocationCache } from "@/lib/square/orders";

export async function POST() {
  await clearToken();
  clearLocationCache();
  return NextResponse.json({ ok: true });
}
