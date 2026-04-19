"use client";

import { useState } from "react";
import { Plus, RefreshCcw, Sparkles } from "lucide-react";
import { useConnectionStatus } from "@/lib/square/use-connection-status";
import { clearAllStatuses } from "@/lib/orders/status-store";

export const MOCK_REFRESH_EVENT = "mock:orders-changed";

export function MockToolbar() {
  const { status } = useConnectionStatus();
  const [busy, setBusy] = useState<"add" | "reset" | null>(null);

  if (!status?.mock) return null;

  async function handleAdd() {
    if (busy) return;
    setBusy("add");
    try {
      await fetch("/api/mock/add", { method: "POST" });
      window.dispatchEvent(new Event(MOCK_REFRESH_EVENT));
    } finally {
      setBusy(null);
    }
  }

  async function handleReset() {
    if (busy) return;
    if (!confirm("Reset demo orders to initial seed?")) return;
    setBusy("reset");
    try {
      await fetch("/api/mock/reseed", { method: "POST" });
      clearAllStatuses();
      window.dispatchEvent(new Event(MOCK_REFRESH_EVENT));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="hidden items-center gap-2 md:inline-flex">
      <span className="inline-flex h-7 items-center gap-1.5 rounded-full border border-[var(--brand-primary)]/30 bg-[var(--brand-primary-tint)] px-2.5 text-[10px] font-bold uppercase tracking-wider text-[var(--brand-primary)]">
        <Sparkles size={11} strokeWidth={2.25} aria-hidden="true" />
        Demo mode
      </span>

      <button
        type="button"
        onClick={handleAdd}
        disabled={busy !== null}
        className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-[var(--border-default)] bg-white px-3 text-xs font-semibold text-[var(--text-primary)] transition-colors duration-150 hover:bg-[var(--surface-canvas)] disabled:cursor-wait disabled:opacity-60"
      >
        <Plus size={13} strokeWidth={2} aria-hidden="true" />
        {busy === "add" ? "Adding…" : "Add demo order"}
      </button>

      <button
        type="button"
        onClick={handleReset}
        disabled={busy !== null}
        title="Reset demo orders"
        aria-label="Reset demo orders"
        className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border border-[var(--border-default)] bg-white text-[var(--text-secondary)] transition-colors duration-150 hover:bg-[var(--surface-canvas)] hover:text-[var(--text-primary)] disabled:cursor-wait disabled:opacity-60"
      >
        <RefreshCcw size={13} strokeWidth={2} aria-hidden="true" />
      </button>
    </div>
  );
}
