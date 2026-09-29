"use client";

import { useSignIn } from "@/components/account-button";

/** Re-prove the keys that hold your tokens (picks up new purchases and transfers). */
export function RefreshHoldings({ label = "Refresh holdings" }: { label?: string }) {
  const { run, status, error } = useSignIn();
  return (
    <div className="flex flex-col items-start gap-1">
      <button
        onClick={run}
        disabled={!!status}
        className="rounded-full border border-line px-4 py-2 text-sm transition hover:border-gold/60 hover:text-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold disabled:opacity-60"
      >
        {status ?? label}
      </button>
      {error && <p className="text-sm text-red-400">{error}</p>}
    </div>
  );
}
