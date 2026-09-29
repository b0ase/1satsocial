"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { Listing } from "@/lib/market";
import type { RoomKind } from "@/lib/room-ref";
import { signIn, walletBalance } from "@/lib/wallet-client";

// Headroom for network + overlay fees when judging whether a listing is affordable.
const FEE_MARGIN_SATS = 5_000;

function sats(n: number) {
  if (n === 1) return "1 sat";
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
  signedIn: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [txid, setTxid] = useState<string | null>(null);
  const [balance, setBalance] = useState<number | null | "loading">(props.signedIn ? "loading" : null);

  async function loadBalance() {
    setBalance("loading");
    setBalance(await walletBalance().catch(() => null));
  }

  // Signed-in users have already connected Yours to this site, so this shouldn't prompt a new connection.
  useEffect(() => {
    if (!props.signedIn) return;
    let live = true;
    walletBalance()
      .catch(() => null)
      .then((b) => live && setBalance(b));
    return () => {
      live = false;
    };
  }, [props.signedIn]);

  const affordable = (l: Listing) => typeof balance !== "number" || l.priceSats + FEE_MARGIN_SATS <= balance;

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
        <h3 className="font-medium">Cheapest ways in</h3>
        {props.floorLabel && <span className="text-sm text-muted">Floor {props.floorLabel}</span>}
      </div>
      <p className="mb-3 text-sm text-muted">
        {balance === "loading" ? (
          "Checking your wallet balance…"
        ) : typeof balance === "number" ? (
          <>
            Your wallet: <span className="text-text">{sats(balance)}</span>
          </>
        ) : (
          <button onClick={loadBalance} className="underline hover:text-text">
            Check what I can afford
          </button>
        )}
      </p>

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
              <ListingAction
                listing={l}
                affordable={affordable(l)}
                busy={busy}
                marketUrl={props.marketUrl}
                onBuy={() => buy(l)}
              />
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

function ListingAction(props: {
  listing: Listing;
  affordable: boolean;
  busy: string | null;
  marketUrl: string;
  onBuy: () => void;
}) {
  const { listing: l, affordable } = props;
  const base = "shrink-0 rounded-full px-4 py-1.5 text-sm transition";
  if (!affordable) {
    return (
      <span className={`${base} cursor-not-allowed border border-line text-muted/60`} title="More than your wallet balance">
        Not enough BSV
      </span>
    );
  }
  if (!l.buyable) {
    // The 1Sat overlay doesn't track this listing, so the SDK can't buy it safely in-app.
    return (
      <a
        href={props.marketUrl}
        target="_blank"
        rel="noreferrer"
        title="This listing can't be bought in-app"
        className={`${base} border border-gold/50 text-gold hover:bg-gold-soft`}
      >
        Buy on 1sat.market ↗
      </a>
    );
  }
  return (
    <button
      onClick={props.onBuy}
      disabled={!!props.busy}
      className={`${base} bg-gold font-medium text-black hover:brightness-110 disabled:opacity-50`}
    >
      {props.busy === l.outpoint ? "Buying…" : "Buy & enter"}
    </button>
  );
}
