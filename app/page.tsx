"use client";

import { Suspense, useState } from "react";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";

/**
 * Root login. There is deliberately no tenant picker — the password itself
 * decides which shop you land on. The server returns the matched tenant and
 * sets a path-scoped session cookie; we just route there.
 */
function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        setError("Incorrect password.");
        return;
      }
      const data = (await res.json()) as { tenant?: string };
      const tenant = data.tenant ?? "";
      const next = searchParams.get("next") ?? "";
      // Only honour `next` when it belongs to the tenant we just logged
      // into — a Margate password must never route into /soho.
      const destination =
        tenant && next.startsWith(`/${tenant}`) ? next : `/${tenant}`;
      router.replace(destination);
      router.refresh();
    } catch {
      setError("Connection error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex flex-1 items-center justify-center bg-[var(--surface-canvas)] px-4 py-10">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm rounded-xl border border-[var(--border-default)] bg-white p-8 shadow-[0_4px_12px_rgba(0,0,0,0.05)]"
      >
        <div className="mb-8 flex flex-col items-center text-center">
          <Image
            src="/rise-and-bun-16x9-with-background.svg"
            alt="Rise & Bun"
            width={224}
            height={68}
            priority
            className="h-16 w-auto select-none"
          />
          <p className="mt-3 text-sm font-medium text-[var(--text-secondary)]">
            Barista panel sign-in
          </p>
        </div>

        <label className="block">
          <span className="mb-2 block text-sm font-semibold text-[var(--text-primary)]">
            Password
          </span>
          <input
            type="password"
            autoFocus
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="h-11 w-full rounded-lg border border-[var(--border-default)] bg-white px-4 text-sm text-[var(--text-primary)] outline-none transition-colors duration-150 focus:border-[var(--brand-primary)] focus:ring-2 focus:ring-[var(--brand-primary)]/20"
          />
        </label>

        {error && (
          <p
            className="mt-3 text-sm font-medium text-[var(--status-late-fg)]"
            role="alert"
          >
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={loading || password.length === 0}
          className="mt-6 inline-flex h-11 w-full cursor-pointer items-center justify-center rounded-lg bg-[var(--brand-primary)] px-4 text-sm font-semibold text-white transition-colors duration-150 hover:bg-[var(--brand-primary-hover)] active:bg-[var(--brand-primary-pressed)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
