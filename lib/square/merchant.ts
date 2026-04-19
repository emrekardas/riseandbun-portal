import "server-only";
import { squareFetch } from "./client";

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

export async function getMerchantInfo(): Promise<SquareMerchant | null> {
  const data = await squareFetch<ListMerchantsResponse>("/v2/merchants", {
    method: "GET",
  });
  return data.merchant?.[0] ?? null;
}
