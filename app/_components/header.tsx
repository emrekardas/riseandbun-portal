"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { LogOut, PlugZap, X } from "lucide-react";
import { useConnectionStatus } from "@/lib/square/use-connection-status";
import { MockToolbar } from "./mock-toolbar";

export function Header() {
  const router = useRouter();
  const [clock, setClock] = useState<string>("");
  const { status, loading, refresh } = useConnectionStatus();

  useEffect(() => {
    const tick = () =>
      setClock(
        new Date().toLocaleTimeString("en-GB", {
          hour: "2-digit",
          minute: "2-digit",
        }),
      );
    tick();
    const interval = window.setInterval(tick, 30_000);
    return () => window.clearInterval(interval);
  }, []);

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  async function handleDisconnect() {
    if (!confirm("Are you sure you want to disconnect from Square?")) return;
    await fetch("/api/square/oauth/disconnect", { method: "POST" });
    await refresh();
  }

  function handleConnect() {
    window.location.href = "/api/square/oauth/start";
  }

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-4 border-b border-[var(--border-default)] bg-white px-4 sm:px-6">
      <div className="flex items-center gap-3">
        <Image
          src="/rise-and-bun-16x9-with-background.svg"
          alt="Rise & Bun"
          width={224}
          height={68}
          priority
          className="h-8 w-auto select-none"
        />
        <span className="hidden h-4 w-px bg-[var(--border-default)] sm:inline-block" />
        <span className="hidden text-sm font-medium text-[var(--text-secondary)] sm:inline">
          Barista panel
        </span>
      </div>

      <div className="flex items-center gap-3">
        <MockToolbar />

        <ConnectionBadge
          loading={loading}
          status={status}
          onConnect={handleConnect}
          onDisconnect={handleDisconnect}
        />

        <span className="hidden font-[family-name:var(--font-jetbrains-mono)] text-sm font-semibold tabular-nums text-[var(--text-primary)] sm:inline">
          {clock}
        </span>

        <button
          type="button"
          onClick={handleLogout}
          className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-[var(--border-default)] bg-white px-3 text-sm font-medium text-[var(--text-secondary)] transition-colors duration-150 hover:bg-[var(--surface-canvas)] hover:text-[var(--text-primary)]"
        >
          <LogOut size={14} strokeWidth={1.75} aria-hidden="true" />
          <span className="hidden sm:inline">Sign out</span>
        </button>
      </div>
    </header>
  );
}

type BadgeProps = {
  loading: boolean;
  status: ReturnType<typeof useConnectionStatus>["status"];
  onConnect: () => void;
  onDisconnect: () => void;
};

function ConnectionBadge({
  loading,
  status,
  onConnect,
  onDisconnect,
}: BadgeProps) {
  if (loading) {
    return (
      <span className="inline-flex h-8 items-center gap-2 rounded-full border border-[var(--border-default)] bg-white px-3 text-xs font-medium text-[var(--text-tertiary)]">
        <span className="h-2 w-2 animate-pulse rounded-full bg-[var(--text-tertiary)]" />
        Checking…
      </span>
    );
  }

  if (!status?.connected) {
    return (
      <button
        type="button"
        onClick={onConnect}
        className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full bg-[var(--brand-primary)] px-4 text-xs font-semibold text-white transition-colors duration-150 hover:bg-[var(--brand-primary-hover)] active:bg-[var(--brand-primary-pressed)]"
      >
        <PlugZap size={14} strokeWidth={1.75} aria-hidden="true" />
        Connect to Square
      </button>
    );
  }

  const merchantName = status.merchant?.businessName ?? "Square";
  const locationLabel =
    status.locations && status.locations.length > 0
      ? status.locations.length === 1
        ? status.locations[0].name ?? "Location"
        : `${status.locations.length} locations`
      : null;
  const tooltip = locationLabel
    ? `Connected to ${merchantName} · ${locationLabel}`
    : `Connected to ${merchantName}`;

  return (
    <div className="group relative inline-flex h-8 items-center gap-2 rounded-full border border-[var(--border-default)] bg-white px-2.5 text-xs font-medium text-[var(--text-secondary)]">
      <span className="relative inline-flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--status-ready-border)] opacity-40" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-[var(--status-ready-border)]" />
      </span>
      <span className="hidden sm:inline">Connected</span>
      <button
        type="button"
        onClick={onDisconnect}
        title={`Disconnect — ${tooltip}`}
        aria-label="Disconnect from Square"
        className="inline-flex h-5 w-5 cursor-pointer items-center justify-center rounded-full text-[var(--text-tertiary)] transition-colors duration-150 hover:bg-[var(--surface-canvas)] hover:text-[var(--status-late-fg)]"
      >
        <X size={12} strokeWidth={2} aria-hidden="true" />
      </button>
      <span
        role="tooltip"
        className="pointer-events-none absolute right-0 top-full z-40 mt-2 inline-flex items-center gap-2 whitespace-nowrap rounded-md border border-[var(--border-default)] bg-white px-3 py-1.5 text-[11px] font-medium text-[var(--text-secondary)] opacity-0 shadow-[0_4px_12px_rgba(0,0,0,0.08)] transition-opacity duration-150 group-hover:opacity-100"
      >
        <span className="font-semibold text-[var(--text-primary)]">{merchantName}</span>
        {locationLabel && (
          <>
            <span className="text-[var(--text-tertiary)]">·</span>
            <span>{locationLabel}</span>
          </>
        )}
      </span>
    </div>
  );
}
