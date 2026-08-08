import "server-only";
import { squareFetch } from "./client";
import type { TenantId } from "@/lib/tenants";

export type CatalogObject = {
  id: string;
  type: string;
  updated_at?: string;
  is_deleted?: boolean;
  present_at_all_locations?: boolean;
  category_data?: {
    name?: string;
  };
  modifier_list_data?: {
    name?: string;
    selection_type?: string;
    modifiers?: Array<{
      id: string;
      modifier_data?: {
        name?: string;
        price_money?: { amount?: number; currency?: string };
      };
    }>;
  };
  item_data?: {
    name?: string;
    description?: string;
    abbreviation?: string;
    /** @deprecated Square now assigns items to categories via `categories`. */
    category_id?: string;
    categories?: Array<{ id: string; ordinal?: number }>;
    reporting_category?: { id: string };
    variations?: Array<{
      id: string;
      type: string;
      item_variation_data?: {
        name?: string;
        sku?: string;
        pricing_type?: string;
        price_money?: { amount?: number; currency?: string };
      };
    }>;
    modifier_list_info?: Array<{
      modifier_list_id: string;
      enabled?: boolean;
    }>;
  };
};

type ListCatalogResponse = {
  cursor?: string;
  objects?: CatalogObject[];
};

export async function listCatalog(
  tenant: TenantId,
  types: string[] = ["ITEM", "CATEGORY", "MODIFIER_LIST"],
): Promise<CatalogObject[]> {
  const all: CatalogObject[] = [];
  let cursor: string | undefined;

  do {
    const params = new URLSearchParams({ types: types.join(",") });
    if (cursor) params.set("cursor", cursor);

    const data = await squareFetch<ListCatalogResponse>(
      tenant,
      `/v2/catalog/list?${params.toString()}`,
      { method: "GET" },
    );

    if (data.objects?.length) {
      all.push(...data.objects);
    }
    cursor = data.cursor;
  } while (cursor);

  return all;
}
