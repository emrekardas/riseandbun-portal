import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import type { NextRequest } from "next/server";
import { buildAuthorizeUrl } from "@/lib/square/oauth";
import { publicUrl } from "@/lib/http/origin";
import { tenantFromRequest } from "@/lib/tenants";

const STATE_COOKIE = "rb_oauth_state";

/**
 * Square allows exactly ONE redirect URL per app, so every tenant shares the
 * bare `/api/square/oauth/callback` endpoint registered in the dashboard.
 * The tenant is carried through the flow inside the OAuth `state`
 * (`<tenant>.<random>`), and the state cookie is root-scoped so the shared
 * callback receives it.
 */
export async function GET(request: NextRequest) {
  const tenant = tenantFromRequest(request);
  const state = `${tenant}.${randomBytes(24).toString("hex")}`;

  const redirectUri = publicUrl(
    request,
    "/api/square/oauth/callback",
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
    path: "/",
    maxAge: 600,
  });
  return response;
}
