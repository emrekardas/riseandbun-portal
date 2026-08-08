import "server-only";
import { squareFetch } from "./client";
import type { TenantId } from "@/lib/tenants";

export type SquareMerchant = {
  id: string;
  business_name?: string;
  country?: string;
  language_code?: string;
  currency?: string;
  status?: "ACTIVE" | "INACTIVE";
  main_location_id?: string;
};

type ListMerchantsResponse = {
  merchant?: SquareMerchant[];
};

export async function getMerchantInfo(
  tenant: TenantId,
): Promise<SquareMerchant | null> {
  const data = await squareFetch<ListMerchantsResponse>(tenant, "/v2/merchants", {
    method: "GET",
  });
  return data.merchant?.[0] ?? null;
}
