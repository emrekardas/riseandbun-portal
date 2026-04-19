import "server-only";
import type { SquareOrder } from "@/lib/square/orders";

/**
 * In-memory mock orders store. Survives across requests within a single
 * Next.js dev server process. Cleared on dev restart.
 */

type OrderTemplate = {
  ticket_name: string;
  minutesAgo: number;
  line_items: Array<{
    quantity: string;
    name: string;
    variation_name?: string;
    note?: string;
    modifiers?: Array<{ name: string }>;
  }>;
};

const SEED_TEMPLATES: OrderTemplate[] = [
  {
    ticket_name: "Sarah",
    minutesAgo: 0,
    line_items: [
      {
        quantity: "1",
        name: "Flat White",
        variation_name: "Regular",
        modifiers: [{ name: "Oat milk" }],
      },
      { quantity: "1", name: "Almond Croissant" },
    ],
  },
  {
    ticket_name: "Pickup #842",
    minutesAgo: 1,
    line_items: [
      { quantity: "3", name: "Espresso" },
      { quantity: "1", name: "Cappuccino", variation_name: "Decaf" },
    ],
  },
  {
    ticket_name: "Mike",
    minutesAgo: 2,
    line_items: [
      {
        quantity: "2",
        name: "Americano",
        variation_name: "Large",
        modifiers: [{ name: "Extra shot" }],
      },
      { quantity: "1", name: "Pain au Chocolat" },
    ],
  },
  {
    ticket_name: "Jen",
    minutesAgo: 4,
    line_items: [
      { quantity: "1", name: "Iced Latte", modifiers: [{ name: "Vanilla syrup" }, { name: "Oat milk" }] },
      { quantity: "1", name: "Banana Bread", note: "Warmed up" },
    ],
  },
  {
    ticket_name: "Ana",
    minutesAgo: 6,
    line_items: [
      {
        quantity: "1",
        name: "Cortado",
        modifiers: [{ name: "Single origin Ethiopian" }],
        note: "Please make it strong, double shot",
      },
      {
        quantity: "2",
        name: "Chai Latte",
        variation_name: "Medium",
        modifiers: [{ name: "Soy milk" }, { name: "Honey" }],
      },
    ],
  },
  {
    ticket_name: "Tom · Table 4",
    minutesAgo: 9,
    line_items: [
      {
        quantity: "1",
        name: "Pour Over",
        variation_name: "House blend",
        modifiers: [{ name: "Single origin" }],
        note: "No sugar, hot water on the side",
      },
    ],
  },
];

const ADHOC_TEMPLATES: OrderTemplate[] = [
  {
    ticket_name: "Walk-in",
    minutesAgo: 0,
    line_items: [
      { quantity: "1", name: "Cappuccino", modifiers: [{ name: "Extra foam" }] },
    ],
  },
  {
    ticket_name: "Lucy",
    minutesAgo: 0,
    line_items: [
      { quantity: "1", name: "Mocha", variation_name: "Large", modifiers: [{ name: "Whipped cream" }] },
      { quantity: "1", name: "Brownie" },
    ],
  },
  {
    ticket_name: "Daniel · Table 2",
    minutesAgo: 0,
    line_items: [
      { quantity: "2", name: "Long Black", note: "Both decaf" },
    ],
  },
  {
    ticket_name: "Pickup #" + Math.floor(Math.random() * 900 + 100),
    minutesAgo: 0,
    line_items: [
      { quantity: "1", name: "Matcha Latte", modifiers: [{ name: "Almond milk" }] },
      { quantity: "1", name: "Croissant" },
    ],
  },
];

function randomShortId(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let id = "";
  for (let i = 0; i < 6; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}

function randomReceiptNumber(): string {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let id = "";
  for (let i = 0; i < 4; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}

function templateToOrder(t: OrderTemplate): SquareOrder {
  const created = new Date(Date.now() - t.minutesAgo * 60_000);
  const receipt = randomReceiptNumber();
  return {
    id: `mock_${randomShortId()}`,
    location_id: "MOCK_LOC",
    state: "OPEN",
    created_at: created.toISOString(),
    updated_at: created.toISOString(),
    source: { name: "Mock POS" },
    ticket_name: t.ticket_name,
    receipt_number: receipt,
    tenders: [{ id: `${receipt}${randomShortId()}MOCK`, type: "CARD" }],
    line_items: t.line_items.map((li, idx) => ({
      uid: `li_${idx}_${randomShortId()}`,
      quantity: li.quantity,
      name: li.name,
      variation_name: li.variation_name,
      note: li.note,
      modifiers: li.modifiers?.map((m, mIdx) => ({
        uid: `mod_${mIdx}_${randomShortId()}`,
        name: m.name,
      })),
    })),
  };
}

let store: SquareOrder[] | null = null;

function ensureSeeded(): SquareOrder[] {
  if (store === null) {
    store = SEED_TEMPLATES.map(templateToOrder);
  }
  return store;
}

export function getMockOrders(): SquareOrder[] {
  return ensureSeeded();
}

export function addMockOrder(): SquareOrder {
  const list = ensureSeeded();
  const template =
    ADHOC_TEMPLATES[Math.floor(Math.random() * ADHOC_TEMPLATES.length)];
  const order = templateToOrder({ ...template, minutesAgo: 0 });
  list.unshift(order);
  return order;
}

export function clearMockOrders(): void {
  store = [];
}

export function reseedMockOrders(): SquareOrder[] {
  store = SEED_TEMPLATES.map(templateToOrder);
  return store;
}
