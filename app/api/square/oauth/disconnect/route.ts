import { NextResponse } from "next/server";
import { clearToken } from "@/lib/square/token-store";
import { clearLocationCache } from "@/lib/square/orders";
import { tenantFromRequest } from "@/lib/tenants";

export async function POST(request: Request) {
  const tenant = tenantFromRequest(request);
  await clearToken(tenant);
  clearLocationCache(tenant);
  return NextResponse.json({ ok: true });
}
