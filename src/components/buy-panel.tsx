"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Listing } from "@/lib/market";
import type { RoomKind } from "@/lib/room-ref";
import { signIn } from "@/lib/wallet-client";

function sats(n: number) {
  return n >= 1e8 ? `${(n / 1e8).toLocaleString("en-US", { maximumFractionDigits: 4 })} BSV` : `${n.toLocaleString("en-US")} sats`;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function BuyPanel(props: {
  kind: RoomKind;
  roomId: string;
  title: string;
  listings: Listing[];
  floorLabel: string | null;
  marketUrl: string;
  messagesApi: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [txid, setTxid] = useState<string | null>(null);

  async function buy(l: Listing) {
    const ok = window.confirm(`Buy ${l.label} for ${sats(l.priceSats)}?\n\nYou'll confirm the payment in Yours Wallet.`);
    if (!ok) return;
    setBusy(l.outpoint);
    setError(null);
    try {
      setStatus("Confirm the purchase in Yours…");
      const { buyListing } = await import("@/lib/buy-client");
      const id = await buyListing({ kind: props.kind, roomId: props.roomId, outpoint: l.outpoint, amount: l.amount });
      setTxid(id);

      // Re-prove holdings so the server sees the key the new token landed on.
      await signIn(setStatus);
      setStatus("Waiting for the indexer to see your purchase…");
      for (let i = 0; i < 20; i++) {
        const res = await fetch(props.messagesApi);
        if (res.ok) {
          setStatus("You're in.");
          router.refresh();
          return;
        }
        await sleep(3000);
      }
      setStatus(null);
      setError("Purchase sent, but the indexer hasn't caught up yet. Refresh holdings in a minute.");
    } catch (e) {
      setStatus(null);
      setError(e instanceof Error ? e.message : "Purchase failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="w-full max-w-lg text-left">
      <div className="mb-3 flex items-baseline justify-between">
        <h3 className="font-medium">Buy in</h3>
        {props.floorLabel && <span className="text-sm text-muted">Floor {props.floorLabel}</span>}
      </div>

      {props.listings.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line p-4 text-sm text-muted">
          No live listings right now.{" "}
          <a href={props.marketUrl} target="_blank" rel="noreferrer" className="text-gold underline">
            Check 1sat.market
          </a>
        </p>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-panel-2">
          {props.listings.map((l) => (
            <li key={l.outpoint} className="flex items-center gap-3 p-3">
              {l.image && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={l.image} alt="" className="h-10 w-10 rounded-md object-cover" loading="lazy" />
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{l.label}</p>
                <p className="text-sm text-gold">{sats(l.priceSats)}</p>
              </div>
              {l.buyable ? (
                <button
                  onClick={() => buy(l)}
                  disabled={!!busy}
                  className="shrink-0 rounded-full bg-gold px-4 py-1.5 text-sm font-medium text-black transition hover:brightness-110 disabled:opacity-50"
                >
                  {busy === l.outpoint ? "Buying…" : "Buy & enter"}
                </button>
              ) : (
                <a
                  href={props.marketUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="shrink-0 rounded-full border border-line px-4 py-1.5 text-sm text-muted hover:text-text"
                >
                  On 1sat.market
                </a>
              )}
            </li>
          ))}
        </ul>
      )}

      {status && <p className="mt-3 text-sm text-gold">{status}</p>}
      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
      {txid && (
        <p className="mt-2 text-xs text-muted">
          Tx{" "}
          <a href={`https://whatsonchain.com/tx/${txid}`} target="_blank" rel="noreferrer" className="underline">
            {txid.slice(0, 12)}…
          </a>
        </p>
      )}
      <p className="mt-3 text-xs text-muted">
        Purchases are paid from your Yours Wallet and settle on-chain. Prices are set by sellers on the 1Sat orderbook.
      </p>
    </div>
  );
}
