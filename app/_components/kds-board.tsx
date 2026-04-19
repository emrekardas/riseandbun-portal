"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Coffee, PackageCheck, PlugZap, Undo2 } from "lucide-react";
import { useOrders } from "@/lib/orders/use-orders";
import { pruneStatuses, setOrderStatus, useStatusMap } from "@/lib/orders/status-store";
import type { SquareOrder } from "@/lib/square/orders";
import type { StatusEntry } from "@/lib/orders/types";
import { isDrink } from "@/lib/menu/drinks";
import { OrderCard } from "./order-card";

const COMPLETED_VISIBLE_MS = 30 * 60 * 1000;

export function KdsBoard() {
  const { orders, fetchedAt, loading, error, notConnected, refresh } =
    useOrders();
  const statuses = useStatusMap();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (orders.length === 0) return;
    const ids = new Set(orders.map((o) => o.id));
    pruneStatuses(ids);
  }, [orders]);

  const { active, completed } = useMemo(() => {
    const activeOrders: SquareOrder[] = [];
    const completedOrders: SquareOrder[] = [];

    for (const order of orders) {
      const entry = statuses[order.id];
      const status = entry?.status ?? "pending";

      if (status === "completed") {
        if (entry) {
          const ageMs = now - new Date(entry.updatedAt).getTime();
          if (ageMs <= COMPLETED_VISIBLE_MS) {
            completedOrders.push(order);
          }
        }
        continue;
      }

      activeOrders.push(order);
    }

    activeOrders.sort((a, b) => {
      const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
      const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
      return ta - tb;
    });

    completedOrders.sort((a, b) => {
      const ea = statuses[a.id]?.updatedAt ?? "";
      const eb = statuses[b.id]?.updatedAt ?? "";
      return eb.localeCompare(ea);
    });

    return { active: activeOrders, completed: completedOrders };
  }, [orders, statuses, now]);

  return (
    <div className="flex flex-1 flex-col bg-[var(--surface-canvas)]">
      <section className="flex flex-1 flex-col px-4 py-6 sm:px-6">
        <div className="mb-4 flex items-baseline justify-between">
          <h2 className="text-base font-semibold text-[var(--text-primary)]">
            Active orders
          </h2>
          <span className="inline-flex items-center rounded-full border border-[var(--border-default)] bg-white px-2.5 py-0.5 text-xs font-semibold text-[var(--text-secondary)]">
            {active.length} {active.length === 1 ? "order" : "orders"}
          </span>
        </div>

        <div className="flex min-h-[60vh] flex-1 flex-col">
          {notConnected ? (
            <CenteredFill>
              <NotConnectedCard />
            </CenteredFill>
          ) : loading && active.length === 0 ? (
            <SkeletonGrid />
          ) : error ? (
            <ErrorCard message={error} onRetry={refresh} />
          ) : active.length === 0 ? (
            <CenteredFill>
              <EmptyState fetchedAt={fetchedAt} />
            </CenteredFill>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {active.map((order) => (
                <OrderCard
                  key={order.id}
                  order={order}
                  entry={statuses[order.id]}
                  now={now}
                />
              ))}
            </div>
          )}
        </div>
      </section>

      {completed.length > 0 && (
        <CompletedStrip
          orders={completed}
          statuses={statuses}
          now={now}
        />
      )}
    </div>
  );
}

function CenteredFill({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 items-center justify-center">{children}</div>
  );
}

type CompletedStripProps = {
  orders: SquareOrder[];
  statuses: Record<string, StatusEntry>;
  now: number;
};

function CompletedStrip({ orders, statuses, now }: CompletedStripProps) {
  const [expanded, setExpanded] = useState(true);

  return (
    <section className="border-t border-[var(--border-default)] bg-white px-4 py-4 sm:px-6">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="mb-3 flex w-full cursor-pointer items-baseline justify-between text-left"
        aria-expanded={expanded}
      >
        <span className="inline-flex items-baseline gap-2">
          <span className="font-[family-name:var(--font-fredoka)] text-base font-semibold text-[var(--tenant-brown)]">
            Recently done
          </span>
          <span className="inline-flex items-center rounded-full border border-[var(--border-default)] bg-white px-2 py-0.5 text-[11px] font-semibold text-[var(--text-secondary)]">
            {orders.length}
          </span>
        </span>
        <span className="text-xs font-medium text-[var(--text-tertiary)]">
          {expanded ? "Hide" : "Show"} · auto-hides after 30 min
        </span>
      </button>

      {expanded && (
        <ul className="divide-y divide-[var(--border-subtle)] overflow-hidden rounded-lg border border-[var(--border-subtle)]">
          {orders.map((order) => (
            <CompletedRow
              key={order.id}
              order={order}
              entry={statuses[order.id]}
              now={now}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

type CompletedRowProps = {
  order: SquareOrder;
  entry: StatusEntry | undefined;
  now: number;
};

function CompletedRow({ order, entry, now }: CompletedRowProps) {
  const drinks = (order.line_items ?? []).filter((li) => isDrink(li.name));
  const drinkCount = drinks.reduce(
    (sum, li) => sum + Number(li.quantity ?? 1),
    0,
  );
  const completedAt = entry?.updatedAt
    ? new Date(entry.updatedAt).toLocaleTimeString("en-GB", {
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";
  const ageMin = entry?.updatedAt
    ? Math.max(0, Math.floor((now - new Date(entry.updatedAt).getTime()) / 60000))
    : 0;
  const receiptDisplay = (
    order.receipt_number ?? order.id.slice(-4)
  ).toUpperCase();
  const itemSummary = drinks
    .slice(0, 2)
    .map((li) => `${li.quantity ?? 1}× ${li.name ?? "Item"}`)
    .join(", ");
  const extra = drinks.length > 2 ? ` +${drinks.length - 2} more` : "";

  return (
    <li className="flex items-center gap-3 bg-white px-3 py-2.5 text-sm hover:bg-[var(--surface-canvas)]/60">
      <PackageCheck
        size={14}
        strokeWidth={2}
        className="shrink-0 text-[var(--status-ready-fg)]"
        aria-hidden="true"
      />
      <span className="font-[family-name:var(--font-jetbrains-mono)] text-[13px] font-bold tabular-nums text-[var(--text-primary)]">
        #{receiptDisplay}
      </span>
      {order.ticket_name && (
        <span className="min-w-0 truncate font-semibold text-[var(--text-primary)]">
          {order.ticket_name}
        </span>
      )}
      <span className="hidden truncate text-xs text-[var(--text-secondary)] sm:inline">
        {itemSummary}
        {extra}
      </span>
      <span className="ml-auto inline-flex items-center gap-2 shrink-0 text-xs">
        <span className="hidden font-[family-name:var(--font-jetbrains-mono)] tabular-nums text-[var(--text-tertiary)] sm:inline">
          {drinkCount} {drinkCount === 1 ? "drink" : "drinks"}
        </span>
        <span className="font-[family-name:var(--font-jetbrains-mono)] tabular-nums text-[var(--text-secondary)]">
          {completedAt}
          <span className="ml-1 text-[var(--text-tertiary)]">
            · {ageMin}m ago
          </span>
        </span>
        <button
          type="button"
          onClick={() => setOrderStatus(order.id, "ready")}
          className="inline-flex h-7 cursor-pointer items-center gap-1 rounded-md border border-[var(--border-default)] bg-white px-2 text-[11px] font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-canvas)] hover:text-[var(--text-primary)]"
          aria-label={`Undo, restore receipt ${receiptDisplay}`}
        >
          <Undo2 size={12} strokeWidth={2} aria-hidden="true" />
          Undo
        </button>
      </span>
    </li>
  );
}

function NotConnectedCard() {
  return (
    <div className="animate-fade-in flex flex-col items-center rounded-xl border border-dashed border-[var(--border-strong)] bg-white p-10 text-center">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-[var(--brand-primary-tint)] text-[var(--brand-primary)]">
        <PlugZap size={24} strokeWidth={1.75} aria-hidden="true" />
      </div>
      <p className="text-lg font-semibold text-[var(--text-primary)]">
        Not connected to Square
      </p>
      <p className="mx-auto mt-2 max-w-md text-sm text-[var(--text-secondary)]">
        Use the button in the top right, or the one below, to sign in with the
        Rise &amp; Bun Square account.
      </p>
      <a
        href="/api/square/oauth/start"
        className="mt-5 inline-flex h-11 cursor-pointer items-center gap-2 rounded-lg bg-[var(--brand-primary)] px-5 text-sm font-semibold text-white transition-colors duration-150 hover:bg-[var(--brand-primary-hover)] active:bg-[var(--brand-primary-pressed)]"
      >
        <PlugZap size={16} strokeWidth={1.75} aria-hidden="true" />
        Connect to Square
      </a>
    </div>
  );
}

function ErrorCard({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="animate-fade-in flex items-start gap-3 rounded-xl border border-[var(--status-late-border)]/40 bg-[var(--status-late-bg)] p-4">
      <div className="mt-0.5 shrink-0 text-[var(--status-late-fg)]">
        <AlertTriangle size={20} strokeWidth={2} aria-hidden="true" />
      </div>
      <div className="flex-1">
        <p className="text-sm font-semibold text-[var(--status-late-fg)]">
          Something went wrong
        </p>
        <p className="mt-0.5 text-sm text-[var(--status-late-fg)]/85">
          {message}
        </p>
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 inline-flex h-9 cursor-pointer items-center rounded-lg border border-[var(--status-late-border)]/40 bg-white px-3 text-sm font-medium text-[var(--status-late-fg)] transition-colors duration-150 hover:bg-[var(--status-late-bg)]"
        >
          Try again
        </button>
      </div>
    </div>
  );
}

function EmptyState({ fetchedAt }: { fetchedAt: string | null }) {
  return (
    <div className="animate-fade-in flex flex-col items-center rounded-xl border border-dashed border-[var(--border-default)] bg-white p-12 text-center">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-[var(--surface-canvas)] text-[var(--text-tertiary)]">
        <Coffee size={28} strokeWidth={1.5} aria-hidden="true" />
      </div>
      <p className="text-lg font-semibold text-[var(--text-primary)]">
        All caught up
      </p>
      <p className="mt-1 text-sm text-[var(--text-secondary)]">
        No active orders right now.
      </p>
      <p className="mt-3 font-[family-name:var(--font-jetbrains-mono)] text-[11px] tabular-nums text-[var(--text-tertiary)]">
        {fetchedAt
          ? `Last sync · ${new Date(fetchedAt).toLocaleTimeString("en-GB")}`
          : "Loading…"}
      </p>
    </div>
  );
}

function SkeletonGrid() {
  return (
    <div
      className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
      aria-busy="true"
      aria-live="polite"
      aria-label="Loading orders"
    >
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          className="flex flex-col rounded-xl border border-[var(--border-default)] bg-white p-4"
        >
          <div className="mb-3 flex items-center justify-between">
            <div className="skeleton-shimmer h-5 w-24 rounded-md" />
            <div className="skeleton-shimmer h-5 w-16 rounded-full" />
          </div>
          <div className="mb-3 space-y-2">
            <div className="skeleton-shimmer h-9 w-full rounded-md" />
            <div className="skeleton-shimmer h-9 w-full rounded-md" />
          </div>
          <div className="mt-3 flex gap-2">
            <div className="skeleton-shimmer h-12 flex-1 rounded-lg" />
          </div>
        </div>
      ))}
    </div>
  );
}
