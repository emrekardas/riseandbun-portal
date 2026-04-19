import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE_NAME = "rb_session";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

function getSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error(
      "AUTH_SECRET must be set in .env.local (>= 16 chars).",
    );
  }
  return secret;
}

export function getPortalPassword(): string {
  const password = process.env.PORTAL_PASSWORD;
  if (!password) {
    throw new Error("PORTAL_PASSWORD must be set in .env.local.");
  }
  return password;
}

function sign(value: string): string {
  return createHmac("sha256", getSecret()).update(value).digest("hex");
}

export function createSessionToken(): string {
  const issuedAt = Date.now().toString();
  const signature = sign(issuedAt);
  return `${issuedAt}.${signature}`;
}

export function verifySessionToken(token: string | undefined | null): boolean {
  if (!token) return false;
  const [issuedAt, signature] = token.split(".");
  if (!issuedAt || !signature) return false;

  const expectedSignature = sign(issuedAt);
  const a = Buffer.from(signature, "hex");
  const b = Buffer.from(expectedSignature, "hex");
  if (a.length !== b.length) return false;
  if (!timingSafeEqual(a, b)) return false;

  const issuedAtMs = Number.parseInt(issuedAt, 10);
  if (Number.isNaN(issuedAtMs)) return false;
  const ageSeconds = (Date.now() - issuedAtMs) / 1000;
  return ageSeconds < SESSION_MAX_AGE_SECONDS;
}

export function passwordsMatch(input: string): boolean {
  const expected = getPortalPassword();
  const a = Buffer.from(input);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
