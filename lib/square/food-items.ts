import "server-only";
import { listCatalog } from "./catalog";
import type { SquareOrder } from "./orders";
import { getTenant, type TenantId } from "@/lib/tenants";

/**
 * Maps a tenant's Square catalog category (see `foodCategoryName` in
 * lib/tenants.ts) to the set of item-variation ids the KDS treats as food:
 * struck through, sorted last, and pure-food orders hidden from the bar.
 */

const CACHE_MS = 5 * 60 * 1000;

type CacheEntry = { ids: Set<string>; at: number };
const cache = new Map<TenantId, CacheEntry>();
const inflight = new Map<TenantId, Promise<Set<string>>>();

/**
 * Order line items reference a catalog item VARIATION id, but category
 * membership lives on the parent ITEM — so we resolve every variation id
 * belonging to an item in the food category.
 */
async function fetchFoodVariationIds(tenant: TenantId): Promise<Set<string>> {
  const foodCategoryName = getTenant(tenant).foodCategoryName;
  const objects = await listCatalog(tenant, ["ITEM", "CATEGORY"]);

  const foodCategoryIds = new Set(
    objects
      .filter(
        (o) =>
          o.type === "CATEGORY" && o.category_data?.name === foodCategoryName,
      )
      .map((o) => o.id),
  );
  if (foodCategoryIds.size === 0) return new Set();

  const variationIds = new Set<string>();
  for (const obj of objects) {
    if (obj.type !== "ITEM") continue;
    const itemCategoryIds = (obj.item_data?.categories ?? []).map((c) => c.id);
    if (!itemCategoryIds.some((id) => foodCategoryIds.has(id))) continue;
    for (const v of obj.item_data?.variations ?? []) {
      variationIds.add(v.id);
    }
  }
  return variationIds;
}

/**
 * Cached, never-throwing lookup — a transient catalog outage degrades to
 * "no food styling" (stale cache, or empty set) rather than breaking the
 * 2-second order poll that depends on this.
 */
export async function getFoodVariationIds(
  tenant: TenantId,
): Promise<Set<string>> {
  const now = Date.now();
  const cached = cache.get(tenant);
  if (cached && now - cached.at < CACHE_MS) {
    return cached.ids;
  }
  let pending = inflight.get(tenant);
  if (!pending) {
    pending = fetchFoodVariationIds(tenant)
      .then((ids) => {
        cache.set(tenant, { ids, at: Date.now() });
        return ids;
      })
      .catch((error) => {
        console.error(
          `[food-items] catalog lookup failed for ${tenant}, falling back to stale/empty set:`,
          error,
        );
        return cache.get(tenant)?.ids ?? new Set<string>();
      })
      .finally(() => {
        inflight.delete(tenant);
      });
    inflight.set(tenant, pending);
  }
  return pending;
}

export async function markFoodLineItems(
  tenant: TenantId,
  orders: SquareOrder[],
): Promise<SquareOrder[]> {
  const foodVariationIds = await getFoodVariationIds(tenant);
  if (foodVariationIds.size === 0) return orders;

  return orders.map((order) => ({
    ...order,
    line_items: (order.line_items ?? []).map((li) => ({
      ...li,
      is_food: Boolean(
        li.catalog_object_id && foodVariationIds.has(li.catalog_object_id),
      ),
    })),
  }));
}

/**
 * True when the order has at least one line item that is NOT food — i.e.
 * something the bar actually needs to make. Orders that are pure food
 * (or, conservatively, orders we can't fully classify) keep showing;
 * only orders where every line item is confirmed food are hidden.
 */
export function orderHasNonFoodItem(order: SquareOrder): boolean {
  const items = order.line_items ?? [];
  if (items.length === 0) return true;
  return items.some((li) => !li.is_food);
}
