"use client";

/**
 * Client-side tenant helper. Each tablet only ever lives under one tenant
 * prefix (/margate or /soho), so deriving the base path from the current
 * URL is reliable and avoids threading a context through non-hook modules
 * (status-store, use-orders, header…).
 */
export function tenantBase(): string {
  if (typeof window === "undefined") return "";
  const seg = window.location.pathname.split("/")[1];
  return seg === "margate" || seg === "soho" ? `/${seg}` : "";
}
