import { NextResponse } from "next/server";
import {
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_SECONDS,
  createSessionToken,
  passwordsMatch,
} from "@/lib/auth/session";
import { TENANT_IDS, type TenantId } from "@/lib/tenants";

/**
 * Single login endpoint for the root page. The password itself decides the
 * tenant: each tenant has its own password, and whichever matches wins.
 * The session cookie is path-scoped to the tenant prefix, so the browser
 * only ever presents it under /<tenant>.
 */
export async function POST(request: Request) {
  let body: { password?: string };
  try {
    body = (await request.json()) as { password?: string };
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const password = body.password?.trim() ?? "";
  const tenant: TenantId | undefined = password
    ? TENANT_IDS.find((id) => passwordsMatch(id, password))
    : undefined;

  if (!tenant) {
    return NextResponse.json({ error: "invalid_password" }, { status: 401 });
  }

  const token = createSessionToken(tenant);
  const response = NextResponse.json({ ok: true, tenant });
  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: token,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: `/${tenant}`,
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
  // Clear the legacy root-scoped session cookie (pre-multi-tenant deploys
  // set rb_session with Path=/). NB: Next's response.cookies dedupes by
  // name, so a second .set() would REPLACE the session cookie we just
  // wrote — this one must go through a raw appended header instead.
  response.headers.append(
    "set-cookie",
    `${SESSION_COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${
      process.env.NODE_ENV === "production" ? "; Secure" : ""
    }`,
  );
  return response;
}
