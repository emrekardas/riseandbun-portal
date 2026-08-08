"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { tenantBase } from "@/lib/tenant-client";

export type ConnectionStatus = {
  connected: boolean;
  fresh?: boolean;
  mock?: boolean;
  reason?: string;
  message?: string;
  merchant?: {
    id: string;
    businessName?: string;
    country?: string;
    currency?: string;
  } | null;
  locations?: Array<{ id: string; name?: string; timezone?: string }>;
  expiresAt?: string;
};

const REFRESH_MS = 60_000;

export function useConnectionStatus() {
  const [status, setStatus] = useState<ConnectionStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const aliveRef = useRef(true);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`${tenantBase()}/api/square/status`, {
        cache: "no-store",
      });
      const data = (await res.json()) as ConnectionStatus;
      if (!aliveRef.current) return;
      setStatus(data);
      setLoading(false);
    } catch {
      if (!aliveRef.current) return;
      setStatus({ connected: false, reason: "fetch_failed" });
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchStatus();
    const interval = window.setInterval(fetchStatus, REFRESH_MS);
    return () => {
      aliveRef.current = false;
      window.clearInterval(interval);
    };
  }, [fetchStatus]);

  return { status, loading, refresh: fetchStatus };
}
