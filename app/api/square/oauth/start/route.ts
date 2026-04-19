import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { buildAuthorizeUrl } from "@/lib/square/oauth";

const STATE_COOKIE = "rb_oauth_state";

export async function GET() {
  const state = randomBytes(24).toString("hex");
  const url = buildAuthorizeUrl(state);

  const response = NextResponse.redirect(url);
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
