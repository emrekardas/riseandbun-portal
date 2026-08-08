import { NextResponse } from "next/server";
import { isTokenFresh, readToken } from "@/lib/square/token-store";
import { getMerchantInfo } from "@/lib/square/merchant";
import { listActiveLocations } from "@/lib/square/orders";
import { SquareApiError } from "@/lib/square/client";
import { isMockMode } from "@/lib/mock/config";
import { tenantFromRequest } from "@/lib/tenants";

export async function GET(request: Request) {
  const tenant = tenantFromRequest(request);

  if (isMockMode()) {
    return NextResponse.json(
      {
        connected: true,
        fresh: true,
        mock: true,
        merchant: {
          id: "MOCK_MERCHANT",
          businessName: "Rise & Bun (Demo)",
          country: "GB",
          currency: "GBP",
        },
        locations: [
          { id: "MOCK_LOC", name: "Demo Coffee Bar", timezone: "Europe/London" },
        ],
        expiresAt: null,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  const token = await readToken(tenant);
  if (!token) {
    return NextResponse.json(
      { connected: false, reason: "not_connected" },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const [merchant, locations] = await Promise.all([
      getMerchantInfo(tenant),
      listActiveLocations(tenant),
    ]);
    return NextResponse.json(
      {
        connected: true,
        fresh: isTokenFresh(token),
        merchant: merchant
          ? {
              id: merchant.id,
              businessName: merchant.business_name,
              country: merchant.country,
              currency: merchant.currency,
            }
          : null,
        locations: locations.map((l) => ({
          id: l.id,
          name: l.name,
          timezone: l.timezone,
        })),
        expiresAt: token.expiresAt,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    const status =
      err instanceof SquareApiError ? err.status : 500;
    const message = err instanceof Error ? err.message : "unknown_error";
    return NextResponse.json(
      { connected: false, reason: "api_error", status, message },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
