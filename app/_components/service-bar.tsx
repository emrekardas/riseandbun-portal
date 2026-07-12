"use client";

import { useEffect, useMemo, useState } from "react";
import { useOrdersContext } from "@/lib/orders/orders-context";
import { useStatusMap } from "@/lib/orders/status-store";
import { useStats } from "@/lib/orders/client-stats-store";
import {
  deriveService,
  formatMinutes,
  formatPrep,
  LATE_MIN,
  SERVICE_LABELS,
  type ServiceLevel,
} from "@/lib/orders/metrics";

const SERVICE_COLOR: Record<ServiceLevel, { word: string; dot: string }> = {
  smooth: {
    word: "text-[var(--status-ready-fg)]",
    dot: "bg-[var(--status-ready-border)]",
  },
  busy: {
    word: "text-[var(--status-progress-fg)]",
    dot: "bg-[var(--status-progress-border)]",
  },
  slammed: {
    word: "text-[var(--tenant-accent)]",
    dot: "bg-[var(--tenant-accent)] animate-ready-pulse",
  },
};

function onTimeColor(pct: number | null): string {
  if (pct == null) return "text-[var(--text-tertiary)]";
  if (pct >= 90) return "text-[var(--status-ready-fg)]";
  if (pct >= 75) return "text-[var(--status-progress-fg)]";
  return "text-[var(--tenant-accent)]";
}

/**
 * Service status board — a warm instrument ribbon, not a row of SaaS tiles.
 * Hairline dividers, espresso numbers in mono.
 */
export function ServiceBar() {
  const { orders } = useOrdersContext();
  const statuses = useStatusMap();
  const stats = useStats();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(id);
  }, []);

  const service = useMemo(
    () => deriveService(orders, statuses, now),
    [orders, statuses, now],
  );

  const color = SERVICE_COLOR[service.level];
  const oldestLate = service.oldestMin >= LATE_MIN;

  return (
    <div className="flex items-stretch gap-0 overflow-x-auto border-t border-[var(--border-subtle)] bg-white px-4 sm:px-6">
      {/* Live service status — the hero */}
      <div className="flex shrink-0 items-center gap-2.5 py-3 pr-5">
        <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${color.dot}`} />
        <span className="flex flex-col">
          <span
            className={`text-lg font-semibold leading-none ${color.word}`}
          >
            {SERVICE_LABELS[service.level]}
          </span>
          <span className="mt-1 text-[11px] font-medium text-[var(--text-secondary)]">
            {service.activeCount} active
            {service.waitingCount > 0 && (
              <span className="text-[var(--text-tertiary)]">
                {" · "}
                {service.waitingCount} waiting
              </span>
            )}
          </span>
        </span>
      </div>

      <Metric
        label="On-time"
        value={stats?.onTimePct != null ? `${stats.onTimePct}%` : "·"}
        valueClass={onTimeColor(stats?.onTimePct ?? null)}
      />
      <Metric
        label="Served"
        value={stats ? String(stats.served) : "·"}
      />
      <Metric
        label="Avg prep"
        value={stats?.avgPrepMs != null ? formatPrep(stats.avgPrepMs) : "·"}
      />
      <Metric
        label="Oldest"
        value={service.waitingCount > 0 ? formatMinutes(service.oldestMin) : "·"}
        valueClass={oldestLate ? "text-[var(--tenant-accent)]" : undefined}
        last
      />
    </div>
  );
}

type MetricProps = {
  label: string;
  value: string;
  valueClass?: string;
  last?: boolean;
};

function Metric({ label, value, valueClass, last }: MetricProps) {
  return (
    <div
      className={`flex shrink-0 flex-col justify-center border-l border-[var(--border-subtle)] py-3 pl-4 pr-4 sm:pl-5 ${
        last ? "" : "sm:pr-5"
      }`}
    >
      <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--text-tertiary)]">
        {label}
      </span>
      <span
        className={`mt-1 font-[family-name:var(--font-jetbrains-mono)] text-2xl font-bold leading-none tabular-nums ${
          valueClass ?? "text-[var(--tenant-brown)]"
        }`}
      >
        {value}
      </span>
    </div>
  );
}
