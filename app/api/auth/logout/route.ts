import { NextResponse } from "next/server";
import { SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { tenantFromRequest } from "@/lib/tenants";

export async function POST(request: Request) {
  const tenant = tenantFromRequest(request);
  const response = NextResponse.json({ ok: true });
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  // Clear the tenant-scoped cookie…
  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: `/${tenant}`,
    maxAge: 0,
  });
  // …and any legacy root-scoped one. ResponseCookies dedupes by name, so
  // the second clear must be a raw appended header (see auth/login).
  response.headers.append(
    "set-cookie",
    `${SESSION_COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secure}`,
  );
  return response;
}
