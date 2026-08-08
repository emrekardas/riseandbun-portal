import "server-only";
import { getOAuthConfig, refreshAccessToken } from "./oauth";
import {
  isTokenFresh,
  readToken,
  writeToken,
  type SquareToken,
} from "./token-store";
import type { TenantId } from "@/lib/tenants";

export class SquareApiError extends Error {
  status: number;
  body: unknown;

  constructor(status: number, body: unknown, message?: string) {
    super(message ?? `Square API error (${status})`);
    this.name = "SquareApiError";
    this.status = status;
    this.body = body;
  }
}

export class SquareNotConnectedError extends Error {
  constructor() {
    super("Square is not connected. Use Connect to Square from the portal header.");
    this.name = "SquareNotConnectedError";
  }
}

const inflightRefresh = new Map<TenantId, Promise<SquareToken>>();

async function ensureFreshToken(tenant: TenantId): Promise<SquareToken> {
  const token = await readToken(tenant);
  if (!token) throw new SquareNotConnectedError();
  if (isTokenFresh(token)) return token;

  let inflight = inflightRefresh.get(tenant);
  if (!inflight) {
    inflight = (async () => {
      try {
        const refreshed = await refreshAccessToken(tenant, token.refreshToken);
        const next: SquareToken = {
          accessToken: refreshed.access_token,
          refreshToken: refreshed.refresh_token,
          expiresAt: refreshed.expires_at,
          merchantId: refreshed.merchant_id,
          scopes: token.scopes,
          obtainedAt: new Date().toISOString(),
        };
        await writeToken(tenant, next);
        return next;
      } finally {
        inflightRefresh.delete(tenant);
      }
    })();
    inflightRefresh.set(tenant, inflight);
  }
  return inflight;
}

type SquareRequestInit = Omit<RequestInit, "body" | "headers"> & {
  body?: unknown;
  headers?: Record<string, string>;
};

export async function squareFetch<T>(
  tenant: TenantId,
  path: string,
  init: SquareRequestInit = {},
): Promise<T> {
  const cfg = getOAuthConfig(tenant);
  const token = await ensureFreshToken(tenant);
  const { body, headers, ...rest } = init;

  const response = await fetch(`${cfg.baseUrl}${path}`, {
    ...rest,
    headers: {
      Authorization: `Bearer ${token.accessToken}`,
      "Square-Version": cfg.apiVersion,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });

  const text = await response.text();
  const json: unknown = text ? JSON.parse(text) : {};

  if (!response.ok) {
    throw new SquareApiError(response.status, json);
  }

  return json as T;
}
