import "server-only";
import { listCatalog } from "./catalog";
import type { SquareOrder } from "./orders";

/**
 * Square category name the shop uses for items that don't need bar prep
 * (pastries/bakes). If this category gets renamed in Square, update here.
 */
const FOOD_CATEGORY_NAME = "Buns";

const CACHE_MS = 5 * 60 * 1000;

let cachedFoodVariationIds: Set<string> | null = null;
let cachedAt = 0;
let inflight: Promise<Set<string>> | null = null;

/**
 * Order line items reference a catalog item VARIATION id, but category
 * membership lives on the parent ITEM — so we resolve every variation id
 * belonging to an item in the food category.
 */
async function fetchFoodVariationIds(): Promise<Set<string>> {
  const objects = await listCatalog(["ITEM", "CATEGORY"]);

  const foodCategoryIds = new Set(
    objects
      .filter(
        (o) => o.type === "CATEGORY" && o.category_data?.name === FOOD_CATEGORY_NAME,
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
export async function getFoodVariationIds(): Promise<Set<string>> {
  const now = Date.now();
  if (cachedFoodVariationIds && now - cachedAt < CACHE_MS) {
    return cachedFoodVariationIds;
  }
  if (!inflight) {
    inflight = fetchFoodVariationIds()
      .then((ids) => {
        cachedFoodVariationIds = ids;
        cachedAt = Date.now();
        return ids;
      })
      .catch((error) => {
        console.error(
          "[food-items] catalog lookup failed, falling back to stale/empty set:",
          error,
        );
        return cachedFoodVariationIds ?? new Set<string>();
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

export async function markFoodLineItems(
  orders: SquareOrder[],
): Promise<SquareOrder[]> {
  const foodVariationIds = await getFoodVariationIds();
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
