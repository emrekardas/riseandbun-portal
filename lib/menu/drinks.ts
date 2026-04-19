/**
 * Source-of-truth list of items the barista has to make.
 *
 * The KDS only displays orders that contain at least one of these items.
 * Pure pastry / merch / beans orders are filtered out at the API layer
 * because nothing needs to be prepared at the bar.
 *
 * Snapshot taken from `/api/square/catalog` on 2026-04-19. When the menu
 * grows in Square, append the new drink names here.
 */

const HOT_DRINKS = [
  "espresso single shot",
  "espresso",
  "americano",
  "macchiato",
  "cortado",
  "cappuccino",
  "flat white",
  "latte",
  "coffee",
  "hot chocolate",
  "mocha",
  "chai latte",
  "matcha",
  "tea",
] as const;

const COLD_DRINKS = [
  "iced americano",
  "iced latte",
  "iced matcha latte",
  "iced chai latte",
  "iced vanilla matcha cream",
  "iced strawberry matcha",
  "iced salted caramel matcha",
  "iced biscoff cream latte",
] as const;

/**
 * Beverages that don't need bar preparation but live in the same coffee
 * fridge — opinionated: we *don't* show these on the KDS by default
 * because the cashier just hands them over. Move into DRINK_NAMES if you
 * change your mind.
 */
const SELF_SERVE_DRINKS = [
  "bottled water",
  "sparkling water",
  "coca cola",
  "san pellegrino lemonata",
  "kombucha",
  "kambucha",
] as const;

const DRINK_NAMES: ReadonlySet<string> = new Set([
  ...HOT_DRINKS,
  ...COLD_DRINKS,
]);

/**
 * Items that are sold as separate POS line items in Square but are
 * actually drink add-ons / extras (rather than independent food).
 * The barista needs to see them — so we count them as "drinks" for the
 * purposes of the KDS (no FOOD badge, no line-through), but they are
 * NOT enough on their own to make an order qualify for the bar.
 */
const DRINK_ADDONS = [
  "syrup",
  "vanilla syrup",
  "caramel syrup",
  "hazelnut syrup",
  "extra shot",
  "decaf shot",
  "espresso shot",
  "oat milk",
  "almond milk",
  "soy milk",
  "coconut milk",
  "lactose-free milk",
  "extra foam",
  "whipped cream",
  "cinnamon",
  "honey",
  "vanilla powder",
] as const;

const DRINK_ADDONS_SET: ReadonlySet<string> = new Set(DRINK_ADDONS);

/**
 * Heuristic fallback for items that aren't in the whitelist yet.
 * Catches common drink keywords so a newly added "Iced Pistachio Latte"
 * shows up automatically until someone updates the snapshot above.
 */
const DRINK_KEYWORDS = [
  "latte",
  "matcha",
  "espresso",
  "americano",
  "cappuccino",
  "macchiato",
  "cortado",
  "mocha",
  "chai",
  "coffee",
  "tea ",
  " tea",
  "iced",
  "hot chocolate",
  "flat white",
];

const ADDON_KEYWORDS = ["syrup", "shot", "milk", "foam", "cream"];

function normalise(name: string | undefined): string {
  return (name ?? "").trim().toLowerCase();
}

/**
 * True if the item is a real drink the barista needs to make from scratch.
 * An order with at least one of these is shown on the KDS.
 */
export function isDrink(name: string | undefined): boolean {
  const n = normalise(name);
  if (!n) return false;
  if (DRINK_NAMES.has(n)) return true;
  if (isDrinkAddon(name)) return false;
  return DRINK_KEYWORDS.some((kw) => n.includes(kw));
}

/**
 * True if the item is a drink add-on (Syrup, Extra shot, Oat milk, etc.).
 * These are shown on the KDS card alongside drinks (no FOOD badge),
 * but they don't qualify an order for the KDS by themselves.
 */
export function isDrinkAddon(name: string | undefined): boolean {
  const n = normalise(name);
  if (!n) return false;
  if (DRINK_ADDONS_SET.has(n)) return true;
  return ADDON_KEYWORDS.some((kw) => n.includes(kw));
}

/**
 * True if the item is either a drink OR a drink add-on. The barista
 * cares about both — they should not be styled as "FOOD" on the card.
 */
export function isDrinkItem(name: string | undefined): boolean {
  return isDrink(name) || isDrinkAddon(name);
}

export function isSelfServeDrink(name: string | undefined): boolean {
  return SELF_SERVE_DRINKS.includes(
    normalise(name) as (typeof SELF_SERVE_DRINKS)[number],
  );
}
