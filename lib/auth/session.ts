import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { getPortalPassword, type TenantId } from "@/lib/tenants";

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

function sign(value: string): string {
  return createHmac("sha256", getSecret()).update(value).digest("hex");
}

/**
 * Session tokens are tenant-bound: the signed payload includes the tenant
 * id, so a cookie issued for /margate can never authenticate /soho (the
 * cookie is also path-scoped to the tenant prefix as a second layer).
 */
export function createSessionToken(tenant: TenantId): string {
  const issuedAt = Date.now().toString();
  const signature = sign(`${tenant}:${issuedAt}`);
  return `${issuedAt}.${signature}`;
}

export function verifySessionToken(
  tenant: TenantId,
  token: string | undefined | null,
): boolean {
  if (!token) return false;
  const [issuedAt, signature] = token.split(".");
  if (!issuedAt || !signature) return false;

  const expectedSignature = sign(`${tenant}:${issuedAt}`);
  const a = Buffer.from(signature, "hex");
  const b = Buffer.from(expectedSignature, "hex");
  if (a.length !== b.length) return false;
  if (!timingSafeEqual(a, b)) return false;

  const issuedAtMs = Number.parseInt(issuedAt, 10);
  if (Number.isNaN(issuedAtMs)) return false;
  const ageSeconds = (Date.now() - issuedAtMs) / 1000;
  return ageSeconds < SESSION_MAX_AGE_SECONDS;
}

export function passwordsMatch(tenant: TenantId, input: string): boolean {
  const expected = getPortalPassword(tenant);
  if (!expected) return false;
  const a = Buffer.from(input);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
