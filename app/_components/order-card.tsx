"use client";

import {
  AlertTriangle,
  Check,
  CheckCircle2,
  PackageCheck,
  Sparkles,
  Undo2,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { SquareOrder } from "@/lib/square/orders";
import type { OrderStatus, StatusEntry } from "@/lib/orders/types";
import { setOrderStatus } from "@/lib/orders/status-store";
import { LATE_MIN, WARN_MIN } from "@/lib/orders/metrics";
import { isDrink, isDrinkAddon } from "@/lib/menu/drinks";

type Props = {
  order: SquareOrder;
  entry: StatusEntry | undefined;
  now: number;
};

const STATUS_LABELS: Record<OrderStatus, string> = {
  pending: "New",
  in_progress: "In progress",
  ready: "Ready",
  completed: "Done",
};

const STATUS_ICONS: Record<OrderStatus, LucideIcon> = {
  pending: Sparkles,
  in_progress: Sparkles,
  ready: CheckCircle2,
  completed: PackageCheck,
};

function getStatus(entry: StatusEntry | undefined): OrderStatus {
  return entry?.status ?? "pending";
}

function elapsedMinutes(createdAt: string | undefined, now: number): number {
  if (!createdAt) return 0;
  return Math.max(0, (now - new Date(createdAt).getTime()) / 60000);
}

function formatTime(iso: string | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatElapsed(min: number): string {
  if (min < 1) return "just now";
  if (min < 60) return `${Math.floor(min)} min`;
  const hours = Math.floor(min / 60);
  const remaining = Math.floor(min % 60);
  return `${hours}h ${remaining}m`;
}

function shortId(id: string): string {
  return id.slice(-6).toUpperCase();
}

function formatMoney(
  money: { amount?: number; currency?: string } | undefined,
): string | null {
  if (!money?.amount && money?.amount !== 0) return null;
  const major = money.amount / 100;
  const currency = money.currency ?? "GBP";
  const symbol =
    currency === "GBP" ? "£" : currency === "USD" ? "$" : currency === "EUR" ? "€" : "";
  return `${symbol}${major.toFixed(2)}`;
}

function getReceiptDisplay(order: SquareOrder): string {
  if (order.receipt_number) return order.receipt_number.toUpperCase();
  return shortId(order.id).slice(-4);
}

function getShellClasses(status: OrderStatus, isLate: boolean): string {
  // Docket: depth via soft elevation (not a hard left bar); warm-paper fill.
  const base =
    "border border-[var(--border-subtle)] shadow-[0_3px_10px_-3px_rgba(74,59,50,0.15)] transition-shadow duration-200 hover:shadow-[0_8px_22px_-5px_rgba(74,59,50,0.22)]";
  if (status === "ready") {
    return `${base} border-[var(--status-ready-border)]/40 bg-[var(--status-ready-bg)]`;
  }
  if (status === "completed") {
    return "border border-[var(--border-subtle)] bg-[var(--surface-canvas)] opacity-60";
  }
  if (isLate) {
    return `${base} bg-[#fffaf7]`; // faint warm-red paper signals urgency
  }
  return `${base} bg-[#fffdf8]`; // warm paper
}

function getPillClasses(status: OrderStatus, isLate: boolean): string {
  // Rubber-stamp look: outlined, not a filled chip.
  const base =
    "inline-flex shrink-0 items-center gap-1 rounded-md border-2 px-2 py-0.5 text-[11px] font-bold uppercase tracking-[0.1em]";
  if (status === "ready") {
    return `${base} border-[var(--status-ready-border)] text-[var(--status-ready-fg)] animate-ready-pulse`;
  }
  if (status === "completed") {
    return `${base} border-[var(--border-default)] text-[var(--text-tertiary)]`;
  }
  if (isLate) {
    return `${base} border-[var(--tenant-accent)] text-[var(--tenant-accent)]`;
  }
  return `${base} border-[var(--border-default)] text-[var(--text-secondary)]`;
}

function getElapsedClasses(min: number, status: OrderStatus): string {
  const base = "font-[family-name:var(--font-jetbrains-mono)] tabular-nums";
  if (status === "completed") return `${base} text-[var(--text-tertiary)]`;
  if (min >= LATE_MIN) return `${base} font-bold text-[var(--elapsed-late)]`;
  if (min >= WARN_MIN)
    return `${base} font-semibold text-[var(--elapsed-warn)]`;
  return `${base} font-semibold text-[var(--text-secondary)]`;
}

const BTN_PRIMARY_READY =
  "inline-flex min-h-12 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-lg bg-[var(--status-ready-border)] px-4 text-sm font-semibold text-white transition-colors duration-150 hover:bg-[#006b3a] active:bg-[#005530]";
const BTN_PRIMARY_DONE =
  "inline-flex min-h-12 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-lg bg-[var(--brand-primary)] px-4 text-sm font-semibold text-white transition-colors duration-150 hover:bg-[var(--brand-primary-hover)] active:bg-[var(--brand-primary-pressed)]";
const BTN_UNDO =
  "inline-flex min-h-12 cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-[var(--border-default)] bg-white px-4 text-sm font-medium text-[var(--text-secondary)] transition-colors duration-150 hover:bg-[var(--surface-canvas)] hover:text-[var(--text-primary)] active:bg-[var(--border-subtle)]";

export function OrderCard({ order, entry, now }: Props) {
  const status = getStatus(entry);
  const min = elapsedMinutes(order.created_at, now);
  const isLate = min >= LATE_MIN && status === "pending";

  const StatusIcon = isLate ? AlertTriangle : STATUS_ICONS[status];
  const drinkCount = (order.line_items ?? [])
    .filter((li) => isDrink(li.name))
    .reduce((sum, li) => sum + Number(li.quantity ?? 1), 0);

  const handleAction = (next: OrderStatus) => {
    setOrderStatus(order.id, next, order.created_at);
  };

  return (
    <article
      className={`animate-card-in flex h-[360px] flex-col overflow-hidden rounded-xl ${getShellClasses(
        status,
        isLate,
      )}`}
      aria-label={`Receipt ${getReceiptDisplay(order)}, ${STATUS_LABELS[status]}`}
    >
      {/* Perforated receipt edge */}
      <span
        aria-hidden="true"
        className="block h-[3px] w-full"
        style={{
          backgroundImage:
            "radial-gradient(circle, var(--tenant-brown) 1px, transparent 1.4px)",
          backgroundSize: "7px 3px",
          opacity: 0.28,
        }}
      />
      <header className="flex items-start justify-between gap-3 px-4 pt-4 pb-3">
        <div className="min-w-0 flex-1">
          {order.ticket_name ? (
            <>
              <h3 className="truncate font-[family-name:var(--font-fredoka)] text-xl font-semibold leading-tight text-[var(--tenant-brown)]">
                {order.ticket_name}
              </h3>
              <div className="mt-0.5 flex items-baseline gap-1.5 font-[family-name:var(--font-jetbrains-mono)] text-sm font-semibold tabular-nums text-[var(--text-secondary)]">
                <span className="text-[var(--text-tertiary)]">#</span>
                {getReceiptDisplay(order)}
              </div>
            </>
          ) : (
            <h3 className="flex items-baseline gap-1 truncate font-[family-name:var(--font-jetbrains-mono)] text-2xl font-bold leading-tight tracking-tight text-[var(--text-primary)] tabular-nums">
              <span className="text-[var(--text-tertiary)]">#</span>
              {getReceiptDisplay(order)}
            </h3>
          )}
          <div className="mt-1.5 flex items-center gap-1.5 text-xs">
            <span className="font-[family-name:var(--font-jetbrains-mono)] tabular-nums text-[var(--text-secondary)]">
              {formatTime(order.created_at)}
            </span>
            <span className="text-[var(--text-tertiary)]">·</span>
            <span className={getElapsedClasses(min, status)}>
              {formatElapsed(min)}
            </span>
            {formatMoney(order.total_money) && (
              <>
                <span className="text-[var(--text-tertiary)]">·</span>
                <span className="font-[family-name:var(--font-jetbrains-mono)] tabular-nums text-[var(--text-tertiary)]">
                  {formatMoney(order.total_money)}
                </span>
              </>
            )}
          </div>
        </div>
        <span
          className={getPillClasses(status, isLate)}
          aria-label={`Status: ${isLate ? "Late" : STATUS_LABELS[status]}`}
        >
          <StatusIcon size={12} strokeWidth={2.25} aria-hidden="true" />
          {isLate ? "Late" : STATUS_LABELS[status]}
        </span>
      </header>

      <div
        aria-hidden="true"
        className="mx-4 border-t border-dashed border-[var(--border-default)]"
      />

      <ul className="min-h-0 flex-1 overflow-y-auto px-4">
        {(() => {
          const lineItems = order.line_items ?? [];
          const rank = (name: string | undefined): number => {
            if (isDrink(name)) return 0;
            if (isDrinkAddon(name)) return 1;
            return 2;
          };
          const sorted = [...lineItems].sort(
            (a, b) => rank(a.name) - rank(b.name),
          );
          return sorted.map((item, idx, arr) => {
            const addon = isDrinkAddon(item.name);
            const drink = isDrink(item.name);
            const barRelevant = drink || addon;
            return (
              <li
                key={item.uid ?? idx}
                className={`flex flex-col gap-1 py-2.5 text-sm ${
                  idx < arr.length - 1
                    ? "border-b border-dashed border-[var(--border-default)]"
                    : ""
                } ${barRelevant ? "" : "opacity-55"}`}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <div className="flex items-baseline gap-2 min-w-0">
                    <span
                      className={`shrink-0 font-[family-name:var(--font-jetbrains-mono)] text-base font-bold tabular-nums ${
                        drink
                          ? "text-[var(--text-primary)]"
                          : addon
                          ? "text-[var(--text-secondary)]"
                          : "text-[var(--text-secondary)]"
                      }`}
                    >
                      {item.quantity ?? "1"}×
                    </span>
                    <span
                      className={`truncate ${
                        drink
                          ? "font-semibold text-[var(--text-primary)]"
                          : addon
                          ? "font-medium text-[var(--text-primary)]"
                          : "font-medium text-[var(--text-secondary)] line-through decoration-[var(--text-tertiary)]/40 decoration-1"
                      }`}
                    >
                      {item.name ?? "Item"}
                    </span>
                  </div>
                  {!barRelevant && (
                    <span className="shrink-0 rounded-md bg-[var(--surface-canvas)] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[var(--text-tertiary)]">
                      Food
                    </span>
                  )}
                  {addon && (
                    <span className="shrink-0 rounded-md bg-[var(--brand-primary-tint)] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[var(--brand-primary)]">
                      Add-on
                    </span>
                  )}
                  {drink &&
                    item.variation_name &&
                    item.variation_name.toLowerCase() !== "regular" && (
                      <span className="shrink-0 text-xs font-medium text-[var(--text-secondary)]">
                        {item.variation_name}
                      </span>
                    )}
                </div>
                {barRelevant && item.modifiers && item.modifiers.length > 0 && (
                  <ul className="space-y-0.5 pl-7 text-xs text-[var(--text-secondary)]">
                    {item.modifiers.map((mod, mIdx) => (
                      <li key={mod.uid ?? mIdx}>+ {mod.name}</li>
                    ))}
                  </ul>
                )}
                {barRelevant && item.note && (
                  <p className="ml-7 mt-1 rounded-md bg-[var(--status-progress-bg)] px-2 py-1 text-xs italic text-[var(--status-progress-fg)]">
                    “{item.note}”
                  </p>
                )}
              </li>
            );
          });
        })()}
        {(!order.line_items || order.line_items.length === 0) && (
          <li className="py-2.5 text-sm italic text-[var(--text-tertiary)]">
            No item details
          </li>
        )}
      </ul>

      <footer
        className={`flex flex-wrap gap-2 border-t border-dashed px-3 py-3 ${
          status === "ready"
            ? "border-[var(--status-ready-border)]/30 bg-white/40"
            : "border-[var(--border-default)] bg-[var(--surface-card-hover)]/60"
        }`}
      >
        {status === "pending" && (
          <button
            type="button"
            onClick={() => handleAction("ready")}
            className={BTN_PRIMARY_READY}
          >
            <Check size={16} strokeWidth={2.5} aria-hidden="true" />
            Mark ready
          </button>
        )}
        {status === "ready" && (
          <>
            <button
              type="button"
              onClick={() => handleAction("pending")}
              className={BTN_UNDO}
              aria-label="Undo, mark as new"
            >
              <Undo2 size={16} strokeWidth={2} aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => handleAction("completed")}
              className={BTN_PRIMARY_DONE}
            >
              <PackageCheck size={16} strokeWidth={2} aria-hidden="true" />
              {`Done · ${drinkCount} ${drinkCount === 1 ? "drink" : "drinks"}`}
            </button>
          </>
        )}
        {status === "completed" && (
          <button
            type="button"
            onClick={() => handleAction("ready")}
            className={`${BTN_UNDO} flex-1`}
          >
            <Undo2 size={16} strokeWidth={2} aria-hidden="true" />
            Undo
          </button>
        )}
        {status === "in_progress" && (
          <button
            type="button"
            onClick={() => handleAction("ready")}
            className={BTN_PRIMARY_READY}
          >
            <Check size={16} strokeWidth={2.5} aria-hidden="true" />
            Mark ready
          </button>
        )}
      </footer>
    </article>
  );
}
