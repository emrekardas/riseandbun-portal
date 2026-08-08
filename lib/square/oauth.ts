import "server-only";
import type { TenantId } from "@/lib/tenants";

const SQUARE_BASE_URLS = {
  production: "https://connect.squareup.com",
  sandbox: "https://connect.squareupsandbox.com",
} as const;

export type SquareEnvironment = keyof typeof SQUARE_BASE_URLS;

export type OAuthConfig = {
  applicationId: string;
  applicationSecret: string;
  baseUrl: string;
  apiVersion: string;
  environment: SquareEnvironment;
};

export const OAUTH_SCOPES = [
  "MERCHANT_PROFILE_READ",
  "ORDERS_READ",
  "ORDERS_WRITE",
  "PAYMENTS_READ",
  "ITEMS_READ",
] as const;

/**
 * One Square OAuth app can be authorised by many merchants, so the shared
 * SQUARE_APPLICATION_ID / SECRET cover every tenant. Per-tenant overrides
 * (SQUARE_APPLICATION_ID_SOHO etc.) exist for the case where a shop insists
 * on its own developer app.
 *
 * The redirect URI is intentionally NOT read from env here anymore — it is
 * built per tenant from the request origin (`/<tenant>/api/square/oauth/callback`)
 * by the OAuth start route, so each shop's callback stays under its prefix.
 */
export function getOAuthConfig(tenant: TenantId): OAuthConfig {
  const suffix = tenant.toUpperCase();
  const applicationId =
    process.env[`SQUARE_APPLICATION_ID_${suffix}`] ??
    process.env.SQUARE_APPLICATION_ID;
  const applicationSecret =
    process.env[`SQUARE_APPLICATION_SECRET_${suffix}`] ??
    process.env.SQUARE_APPLICATION_SECRET;
  const apiVersion = process.env.SQUARE_API_VERSION ?? "2026-01-22";
  const environment = (process.env.SQUARE_ENVIRONMENT ??
    "production") as SquareEnvironment;

  if (!applicationId) throw new Error("SQUARE_APPLICATION_ID is missing.");
  if (!applicationSecret)
    throw new Error("SQUARE_APPLICATION_SECRET is missing.");
  if (!(environment in SQUARE_BASE_URLS)) {
    throw new Error(`Invalid SQUARE_ENVIRONMENT: ${environment}`);
  }

  return {
    applicationId,
    applicationSecret,
    baseUrl: SQUARE_BASE_URLS[environment],
    apiVersion,
    environment,
  };
}

export function buildAuthorizeUrl(
  tenant: TenantId,
  redirectUri: string,
  state: string,
): string {
  const cfg = getOAuthConfig(tenant);
  const params = new URLSearchParams({
    client_id: cfg.applicationId,
    scope: OAUTH_SCOPES.join(" "),
    session: "false",
    state,
    redirect_uri: redirectUri,
  });
  return `${cfg.baseUrl}/oauth2/authorize?${params.toString()}`;
}

type ObtainTokenResponse = {
  access_token: string;
  token_type: string;
  expires_at: string;
  merchant_id: string;
  refresh_token: string;
  short_lived?: boolean;
};

export async function exchangeCodeForToken(
  tenant: TenantId,
  code: string,
): Promise<ObtainTokenResponse> {
  const cfg = getOAuthConfig(tenant);
  const res = await fetch(`${cfg.baseUrl}/oauth2/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Square-Version": cfg.apiVersion,
      Accept: "application/json",
    },
    body: JSON.stringify({
      client_id: cfg.applicationId,
      client_secret: cfg.applicationSecret,
      code,
      grant_type: "authorization_code",
    }),
    cache: "no-store",
  });
  const json = (await res.json()) as
    | ObtainTokenResponse
    | { errors?: Array<{ detail?: string }> };
  if (!res.ok) {
    const err = json as { errors?: Array<{ detail?: string }> };
    const detail =
      err.errors?.map((e) => e.detail).join(", ") ?? `HTTP ${res.status}`;
    throw new Error(`Square OAuth obtainToken failed: ${detail}`);
  }
  return json as ObtainTokenResponse;
}

export async function refreshAccessToken(
  tenant: TenantId,
  refreshToken: string,
): Promise<ObtainTokenResponse> {
  const cfg = getOAuthConfig(tenant);
  const res = await fetch(`${cfg.baseUrl}/oauth2/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Square-Version": cfg.apiVersion,
      Accept: "application/json",
    },
    body: JSON.stringify({
      client_id: cfg.applicationId,
      client_secret: cfg.applicationSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
    cache: "no-store",
  });
  const json = (await res.json()) as
    | ObtainTokenResponse
    | { errors?: Array<{ detail?: string }> };
  if (!res.ok) {
    const err = json as { errors?: Array<{ detail?: string }> };
    const detail =
      err.errors?.map((e) => e.detail).join(", ") ?? `HTTP ${res.status}`;
    throw new Error(`Square OAuth refresh failed: ${detail}`);
  }
  return json as ObtainTokenResponse;
}
