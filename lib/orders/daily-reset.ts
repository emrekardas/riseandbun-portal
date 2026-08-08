import "server-only";
import { clearAllStatuses } from "./server-status-store";
import { clearStats } from "./stats-store";
import { TENANT_IDS } from "@/lib/tenants";

/**
 * In-process daily reset of order statuses at 18:00 Europe/London (cafe close).
 *
 * No external cron needed — a single self-rescheduling timer lives in the
 * Node.js server process. Guarded by `globalThis` so it's scheduled exactly
 * once across requests, and `unref()`'d so it never keeps the process alive.
 */

const RESET_HOUR_LONDON = 18;

declare global {

  var __kdsResetTimer: NodeJS.Timeout | undefined;
  var __kdsResetStarted: boolean | undefined;
}

/** Milliseconds from now until the next 18:00 in Europe/London. */
function msUntilNextReset(): number {
  const now = new Date();
  // Re-interpret current instant as London wall-clock time.
  const londonNow = new Date(
    now.toLocaleString("en-US", { timeZone: "Europe/London" }),
  );
  const target = new Date(londonNow);
  target.setHours(RESET_HOUR_LONDON, 0, 0, 0);
  if (londonNow >= target) target.setDate(target.getDate() + 1);
  return Math.max(1_000, target.getTime() - londonNow.getTime());
}

export function ensureDailyResetScheduled(): void {
  if (globalThis.__kdsResetStarted) return;
  globalThis.__kdsResetStarted = true;

  const schedule = () => {
    const delay = msUntilNextReset();
    const timer = setTimeout(async () => {
      try {
        await Promise.all(
          TENANT_IDS.flatMap((tenant) => [
            clearAllStatuses(tenant),
            clearStats(tenant),
          ]),
        );
        console.log(
          "[daily-reset] order statuses + stats cleared for all tenants (18:00 Europe/London)",
        );
      } catch (err) {
        console.error("[daily-reset] failed:", err);
      } finally {
        schedule();
      }
    }, delay);
    if (typeof timer.unref === "function") timer.unref();
    globalThis.__kdsResetTimer = timer;
  };

  schedule();
}
