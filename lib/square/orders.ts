import "server-only";
import { squareFetch } from "./client";
import type { TenantId } from "@/lib/tenants";

export type SquareMoney = {
  amount?: number;
  currency?: string;
};

export type SquareModifier = {
  uid?: string;
  name?: string;
  base_price_money?: SquareMoney;
  total_price_money?: SquareMoney;
};

export type SquareLineItem = {
  uid?: string;
  name?: string;
  quantity?: string;
  variation_name?: string;
  note?: string;
  modifiers?: SquareModifier[];
  base_price_money?: SquareMoney;
  total_money?: SquareMoney;
  gross_sales_money?: SquareMoney;
  /** Catalog item VARIATION id — present when the line item maps to a catalog item. */
  catalog_object_id?: string;
  /** Set server-side from the live Square catalog's "Buns" category. */
  is_food?: boolean;
};

export type SquareTender = {
  id?: string;
  type?: "CARD" | "CASH" | "THIRD_PARTY_CARD" | "SQUARE_GIFT_CARD" | "NO_SALE" | "WALLET" | "BUY_NOW_PAY_LATER" | "OTHER";
  amount_money?: SquareMoney;
  payment_id?: string;
  transaction_id?: string;
};

export type SquareFulfillment = {
  uid?: string;
  type?: "PICKUP" | "DELIVERY" | "SHIPMENT" | "DIGITAL";
  state?: "PROPOSED" | "RESERVED" | "PREPARED" | "COMPLETED" | "CANCELED" | "FAILED";
  pickup_details?: {
    note?: string;
    pickup_at?: string;
    recipient?: {
      display_name?: string;
      phone_number?: string;
    };
  };
};

export type SquareOrder = {
  id: string;
  location_id?: string;
  state?: "OPEN" | "DRAFT" | "COMPLETED" | "CANCELED";
  created_at?: string;
  updated_at?: string;
  closed_at?: string;
  source?: { name?: string };
  ticket_name?: string;
  customer_id?: string;
  line_items?: SquareLineItem[];
  fulfillments?: SquareFulfillment[];
  tenders?: SquareTender[];
  net_amount_due_money?: SquareMoney;
  total_money?: SquareMoney;
  version?: number;
  receipt_number?: string;
};

export type SquareLocation = {
  id: string;
  name?: string;
  status?: "ACTIVE" | "INACTIVE";
  currency?: string;
  timezone?: string;
};

type ListLocationsResponse = {
  locations?: SquareLocation[];
};

type SearchOrdersResponse = {
  orders?: SquareOrder[];
  cursor?: string;
};

const locationCache = new Map<
  TenantId,
  { locations: SquareLocation[]; at: number }
>();
const LOCATION_CACHE_MS = 5 * 60 * 1000;

export async function listActiveLocations(
  tenant: TenantId,
): Promise<SquareLocation[]> {
  const now = Date.now();
  const cached = locationCache.get(tenant);
  if (cached && now - cached.at < LOCATION_CACHE_MS) {
    return cached.locations;
  }

  const data = await squareFetch<ListLocationsResponse>(tenant, "/v2/locations", {
    method: "GET",
  });

  const active = (data.locations ?? []).filter(
    (loc) => loc.status === "ACTIVE",
  );

  locationCache.set(tenant, { locations: active, at: now });
  return active;
}

export function clearLocationCache(tenant: TenantId): void {
  locationCache.delete(tenant);
}

export async function getActiveLocationIds(
  tenant: TenantId,
): Promise<string[]> {
  const locations = await listActiveLocations(tenant);
  if (locations.length === 0) {
    throw new Error("No active Square locations found for this account.");
  }
  return locations.map((loc) => loc.id);
}

function startOfTodayIso(): string {
  const now = new Date();
  const start = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    0,
    0,
    0,
    0,
  );
  return start.toISOString();
}

export async function getTodayOrders(
  tenant: TenantId,
): Promise<SquareOrder[]> {
  const locationIds = await getActiveLocationIds(tenant);
  const startAt = startOfTodayIso();
  const endAt = new Date().toISOString();

  const orders: SquareOrder[] = [];
  let cursor: string | undefined;

  do {
    const data: SearchOrdersResponse = await squareFetch<SearchOrdersResponse>(
      tenant,
      "/v2/orders/search",
      {
        method: "POST",
        body: {
          location_ids: locationIds,
          limit: 200,
          cursor,
          query: {
            filter: {
              date_time_filter: {
                created_at: {
                  start_at: startAt,
                  end_at: endAt,
                },
              },
              state_filter: {
                states: ["OPEN", "COMPLETED"],
              },
            },
            sort: {
              sort_field: "CREATED_AT",
              sort_order: "DESC",
            },
          },
        },
      },
    );

    if (data.orders?.length) {
      orders.push(...data.orders);
    }
    cursor = data.cursor;
  } while (cursor);

  return orders.map(enrichOrder);
}

function enrichOrder(order: SquareOrder): SquareOrder {
  const tenderId = order.tenders?.[0]?.id;
  const receiptNumber = tenderId ? tenderId.slice(0, 4) : undefined;
  return receiptNumber ? { ...order, receipt_number: receiptNumber } : order;
}
