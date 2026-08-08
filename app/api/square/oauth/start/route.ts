import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import type { NextRequest } from "next/server";
import { buildAuthorizeUrl } from "@/lib/square/oauth";
import { publicUrl } from "@/lib/http/origin";
import { tenantFromRequest } from "@/lib/tenants";

const STATE_COOKIE = "rb_oauth_state";

export async function GET(request: NextRequest) {
  const tenant = tenantFromRequest(request);
  const state = randomBytes(24).toString("hex");

  // Per-tenant callback — must be whitelisted in the Square app's
  // OAuth settings (one entry per tenant).
  const redirectUri = publicUrl(
    request,
    `/${tenant}/api/square/oauth/callback`,
  ).toString();

  const response = NextResponse.redirect(
    buildAuthorizeUrl(tenant, redirectUri, state),
  );
  response.cookies.set({
    name: STATE_COOKIE,
    value: state,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: `/${tenant}`,
    maxAge: 600,
  });
  return response;
}
