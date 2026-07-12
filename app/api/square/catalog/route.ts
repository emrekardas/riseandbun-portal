import { NextResponse } from "next/server";
import { listCatalog } from "@/lib/square/catalog";
import { SquareApiError, SquareNotConnectedError } from "@/lib/square/client";

function money(m?: { amount?: number; currency?: string }): string {
  if (!m || m.amount === undefined) return "—";
  return `${(m.amount / 100).toFixed(2)} ${m.currency ?? ""}`.trim();
}

export async function GET() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  try {
    const objects = await listCatalog(["ITEM", "CATEGORY", "MODIFIER_LIST"]);

    const categories = objects.filter((o) => o.type === "CATEGORY");
    const items = objects.filter((o) => o.type === "ITEM");
    const modifierLists = objects.filter((o) => o.type === "MODIFIER_LIST");

    const categoryById = new Map(
      categories.map((c) => [c.id, c.category_data?.name ?? "(no name)"]),
    );

    const itemSummary = items.map((it) => {
      const categoryIds = (it.item_data?.categories ?? []).map((c) => c.id);
      const categoryNames = categoryIds.map(
        (id) => categoryById.get(id) ?? "(unknown)",
      );
      const reportingCategoryId = it.item_data?.reporting_category?.id;
      return {
        id: it.id,
        name: it.item_data?.name ?? "(no name)",
        categories: categoryNames.length > 0 ? categoryNames : ["(none)"],
        reporting_category: reportingCategoryId
          ? categoryById.get(reportingCategoryId) ?? "(unknown)"
          : null,
        variations: (it.item_data?.variations ?? []).map((v) => ({
          id: v.id,
          name: v.item_variation_data?.name ?? "Regular",
          price: money(v.item_variation_data?.price_money),
          pricing_type: v.item_variation_data?.pricing_type,
        })),
        modifier_list_ids:
          it.item_data?.modifier_list_info
            ?.filter((mli) => mli.enabled !== false)
            .map((mli) => mli.modifier_list_id) ?? [],
      };
    });

    const modifierListSummary = modifierLists.map((m) => ({
      id: m.id,
      name: m.modifier_list_data?.name ?? "(no name)",
      selection_type: m.modifier_list_data?.selection_type,
      modifiers: (m.modifier_list_data?.modifiers ?? []).map((mod) => ({
        id: mod.id,
        name: mod.modifier_data?.name ?? "(no name)",
        price: money(mod.modifier_data?.price_money),
      })),
    }));

    console.log("\n===== SQUARE CATALOG =====");
    console.log(
      `${categories.length} categor${categories.length === 1 ? "y" : "ies"}, ${items.length} item${items.length === 1 ? "" : "s"}, ${modifierLists.length} modifier list${modifierLists.length === 1 ? "" : "s"}`,
    );
    if (categories.length > 0) {
      console.log("\nCategories:");
      for (const c of categories) {
        console.log(`  - ${c.category_data?.name ?? "(no name)"} [${c.id}]`);
      }
    }
    console.log("\nItems:");
    for (const it of itemSummary) {
      console.log(`  • ${it.name}  [${it.categories.join(", ")}]`);
      for (const v of it.variations) {
        console.log(`      ${v.name} — ${v.price} (${v.id})`);
      }
      if (it.modifier_list_ids.length > 0) {
        console.log(`      modifier lists: ${it.modifier_list_ids.join(", ")}`);
      }
    }
    if (modifierListSummary.length > 0) {
      console.log("\nModifier lists:");
      for (const m of modifierListSummary) {
        console.log(`  ▸ ${m.name} (${m.selection_type ?? "?"})`);
        for (const mod of m.modifiers) {
          console.log(`      + ${mod.name} — ${mod.price}`);
        }
      }
    }
    console.log("===== /SQUARE CATALOG =====\n");

    return NextResponse.json(
      {
        counts: {
          categories: categories.length,
          items: items.length,
          modifier_lists: modifierLists.length,
        },
        categories: categories.map((c) => ({
          id: c.id,
          name: c.category_data?.name,
        })),
        items: itemSummary,
        modifier_lists: modifierListSummary,
        raw: objects,
      } satisfies Record<string, unknown>,
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof SquareNotConnectedError) {
      return NextResponse.json(
        { error: "not_connected" },
        { status: 409 },
      );
    }
    if (error instanceof SquareApiError) {
      return NextResponse.json(
        { error: "square_api_error", status: error.status, body: error.body },
        { status: 502 },
      );
    }
    const message = error instanceof Error ? error.message : "unknown_error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
