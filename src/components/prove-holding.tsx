"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { proveRoom } from "@/lib/wallet-client";

/** "I hold this": one wallet approval proves the key that holds this room's asset. */
export function ProveHolding({ kind, id }: { kind: string; id: string }) {
  const router = useRouter();
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setError(null);
    try {
      await proveRoom(kind, id, setStatus);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't prove it");
    } finally {
      setStatus(null);
    }
  }

  return (
    <div className="flex flex-col items-center gap-2">
      <button
        onClick={run}
        disabled={!!status}
        className="rounded-full bg-gold px-5 py-2 text-sm font-medium text-black transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold disabled:opacity-60"
      >
        {status ?? "I hold it: prove it"}
      </button>
      {error && <p className="max-w-sm text-sm text-red-400">{error}</p>}
    </div>
  );
}
