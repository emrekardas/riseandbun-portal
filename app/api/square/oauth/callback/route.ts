import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { exchangeCodeForToken } from "@/lib/square/oauth";
import { writeToken } from "@/lib/square/token-store";
import { clearLocationCache, listActiveLocations } from "@/lib/square/orders";
import { getMerchantInfo } from "@/lib/square/merchant";
import { publicUrl } from "@/lib/http/origin";

const STATE_COOKIE = "rb_oauth_state";

function failureRedirect(req: NextRequest, reason: string): NextResponse {
  const url = publicUrl(req, "/");
  url.searchParams.set("square", "error");
  url.searchParams.set("reason", reason);
  return NextResponse.redirect(url);
}

export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const responseType = url.searchParams.get("response_type");
  const sellerError = url.searchParams.get("error");

  if (sellerError) {
    console.error(
      `[Square OAuth] seller denied or returned an error: ${sellerError}`,
    );
    return failureRedirect(request, sellerError);
  }

  const expectedState = request.cookies.get(STATE_COOKIE)?.value;
  if (!state || !expectedState || state !== expectedState) {
    console.error("[Square OAuth] invalid state parameter");
    return failureRedirect(request, "invalid_state");
  }
  if (responseType !== "code" || !code) {
    console.error("[Square OAuth] missing authorization code");
    return failureRedirect(request, "missing_code");
  }

  try {
    const tokenResponse = await exchangeCodeForToken(code);
    await writeToken({
      accessToken: tokenResponse.access_token,
      refreshToken: tokenResponse.refresh_token,
      expiresAt: tokenResponse.expires_at,
      merchantId: tokenResponse.merchant_id,
      obtainedAt: new Date().toISOString(),
    });

    clearLocationCache();

    const [merchant, locations] = await Promise.all([
      getMerchantInfo(),
      listActiveLocations(),
    ]);

    console.log("\n========== Square Connected ==========");
    console.log(`Merchant ID:   ${tokenResponse.merchant_id}`);
    console.log(`Business name: ${merchant?.business_name ?? "(unknown)"}`);
    console.log(`Country:       ${merchant?.country ?? "—"}`);
    console.log(`Currency:      ${merchant?.currency ?? "—"}`);
    console.log(`Token expires: ${tokenResponse.expires_at}`);
    console.log(`Active locations (${locations.length}):`);
    for (const loc of locations) {
      console.log(`  - ${loc.id}  ${loc.name ?? ""}  [${loc.timezone ?? "—"}]`);
    }
    console.log("======================================\n");
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown_error";
    console.error("[Square OAuth] token exchange failed:", message);
    return failureRedirect(request, "exchange_failed");
  }

  const successUrl = publicUrl(request, "/");
  successUrl.searchParams.set("square", "connected");
  const response = NextResponse.redirect(successUrl);
  response.cookies.set({
    name: STATE_COOKIE,
    value: "",
    path: "/",
    maxAge: 0,
  });
  return response;
}
