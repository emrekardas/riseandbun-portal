import "server-only";
import { getOAuthConfig, refreshAccessToken } from "./oauth";
import {
  isTokenFresh,
  readToken,
  writeToken,
  type SquareToken,
} from "./token-store";

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
    super("Square is not connected. Visit /api/square/oauth/start to link an account.");
    this.name = "SquareNotConnectedError";
  }
}

let inflightRefresh: Promise<SquareToken> | null = null;

async function ensureFreshToken(): Promise<SquareToken> {
  const token = await readToken();
  if (!token) throw new SquareNotConnectedError();
  if (isTokenFresh(token)) return token;

  if (!inflightRefresh) {
    inflightRefresh = (async () => {
      try {
        const refreshed = await refreshAccessToken(token.refreshToken);
        const next: SquareToken = {
          accessToken: refreshed.access_token,
          refreshToken: refreshed.refresh_token,
          expiresAt: refreshed.expires_at,
          merchantId: refreshed.merchant_id,
          scopes: token.scopes,
          obtainedAt: new Date().toISOString(),
        };
        await writeToken(next);
        return next;
      } finally {
        inflightRefresh = null;
      }
    })();
  }
  return inflightRefresh;
}

type SquareRequestInit = Omit<RequestInit, "body" | "headers"> & {
  body?: unknown;
  headers?: Record<string, string>;
};

export async function squareFetch<T>(
  path: string,
  init: SquareRequestInit = {},
): Promise<T> {
  const cfg = getOAuthConfig();
  const token = await ensureFreshToken();
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
