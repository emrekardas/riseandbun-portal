import "server-only";

/**
 * Tenant registry — one portal, one Square merchant per shop.
 *
 * Every tenant lives under its own URL prefix (`/margate`, `/soho`) and has
 * fully isolated state: password, Square OAuth token, orders cache/poller,
 * status + stats files. The proxy (proxy.ts) strips the prefix and forwards
 * the tenant id as the `x-tenant` header; server modules read it from there.
 */

export const TENANT_IDS = ["margate", "soho"] as const;
export type TenantId = (typeof TENANT_IDS)[number];

export const TENANT_HEADER = "x-tenant";

type TenantConfig = {
  id: TenantId;
  displayName: string;
  /**
   * Square catalog category whose items are treated as food on the KDS
   * (struck through, sorted last, pure-food orders hidden).
   */
  foodCategoryName: string;
};

const TENANTS: Record<TenantId, TenantConfig> = {
  margate: {
    id: "margate",
    displayName: "Margate",
    foodCategoryName: "Buns",
  },
  soho: {
    id: "soho",
    displayName: "Soho",
    foodCategoryName: "Buns",
  },
};

export function isTenantId(value: string | undefined | null): value is TenantId {
  return value === "margate" || value === "soho";
}

export function getTenant(id: TenantId): TenantConfig {
  return TENANTS[id];
}

export function listTenants(): TenantConfig[] {
  return TENANT_IDS.map((id) => TENANTS[id]);
}

/**
 * Resolve the tenant for a request. Falls back to "margate" for legacy
 * internal calls so a missing header never breaks the original shop.
 */
export function tenantFromRequest(request: Request): TenantId {
  const header = request.headers.get(TENANT_HEADER);
  return isTenantId(header) ? header : "margate";
}

/** Per-tenant portal password: PORTAL_PASSWORD_<TENANT>, with the original
 *  shared PORTAL_PASSWORD kept as the margate fallback so existing deploys
 *  keep working until the new env vars are set. */
export function getPortalPassword(tenant: TenantId): string | null {
  const specific = process.env[`PORTAL_PASSWORD_${tenant.toUpperCase()}`];
  if (specific) return specific;
  if (tenant === "margate") return process.env.PORTAL_PASSWORD ?? null;
  return null;
}
