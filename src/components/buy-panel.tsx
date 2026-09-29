"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { Listing } from "@/lib/market";
import { formatUsd } from "@/lib/price";
import type { RoomKind } from "@/lib/room-ref";
import { signIn, walletBalance } from "@/lib/wallet-client";

// Headroom for network + overlay fees when judging whether a listing is affordable.
const FEE_MARGIN_SATS = 5_000;
const BUDGET_KEY = "ss_budget_usd";

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
  /** USD per BSV for estimates; null if no price source was reachable. */
  usdPerBsv: number | null;
}) {
  const router = useRouter();
  const usd = props.usdPerBsv;
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [txid, setTxid] = useState<string | null>(null);
  const [balance, setBalance] = useState<number | null | "loading">(props.signedIn ? "loading" : null);
  // Fallback when the wallet won't share its balance: the viewer types a budget in dollars.
  const [budgetUsd, setBudgetUsd] = useState("");

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

  useEffect(() => {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(BUDGET_KEY);
    } catch {
      /* storage unavailable */
    }
    if (saved) queueMicrotask(() => setBudgetUsd(saved));
  }, []);

  function updateBudget(v: string) {
    setBudgetUsd(v);
    try {
      localStorage.setItem(BUDGET_KEY, v);
    } catch {
      /* storage unavailable */
    }
  }

  const budgetSats = usd && Number(budgetUsd) > 0 ? Math.floor((Number(budgetUsd) / usd) * 1e8) : null;
  const limitSats = typeof balance === "number" ? balance : budgetSats;
  const affordable = (l: Listing) => limitSats === null || l.priceSats + FEE_MARGIN_SATS <= limitSats;

  async function buy(l: Listing) {
    const dollars = usd ? ` (about ${formatUsd(l.priceSats, usd)})` : "";
    const ok = window.confirm(
      `Buy ${l.label} for ${sats(l.priceSats)}${dollars}?\n\nNetwork fees are added on top. You'll confirm the payment in Yours Wallet.`,
    );
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
    <div className="w-full max-w-2xl text-left">
      <div className="mb-3 flex items-baseline justify-between">
        <h3 className="font-medium">Cheapest ways in</h3>
        {props.floorLabel && <span className="text-sm text-muted">Floor {props.floorLabel}</span>}
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-muted">
        {balance === "loading" ? (
          <span>Checking your wallet balance…</span>
        ) : typeof balance === "number" ? (
          <span>
            Your wallet: <span className="text-text">{sats(balance)}</span>
            {usd && <> · {formatUsd(balance, usd)}</>}
          </span>
        ) : (
          <>
            {usd && (
              <label className="flex items-center gap-2">
                My budget
                <span className="flex items-center rounded-full border border-line bg-panel-2 px-3 py-1 focus-within:border-gold/60">
                  $
                  <input
                    value={budgetUsd}
                    onChange={(e) => updateBudget(e.target.value.replace(/[^0-9.]/g, ""))}
                    inputMode="decimal"
                    placeholder="0.00"
                    className="w-16 bg-transparent pl-1 text-text outline-none placeholder:text-muted"
                  />
                </span>
              </label>
            )}
            <button onClick={loadBalance} className="underline hover:text-text">
              Read my wallet balance
            </button>
          </>
        )}
      </div>

      {props.listings.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line p-4 text-sm text-muted">
          No live listings right now.{" "}
          <a href={props.marketUrl} target="_blank" rel="noreferrer" className="text-gold underline">
            Check 1sat.market
          </a>
        </p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-line bg-panel-2">
          <div className="grid grid-cols-[1fr_auto_4.5rem_8.5rem] gap-3 border-b border-line px-3 py-2 text-[11px] uppercase tracking-wide text-muted">
            <span>Listing</span>
            <span className="text-right">Price</span>
            <span className="text-right">≈ USD</span>
            <span />
          </div>
          <ul className="divide-y divide-line">
            {props.listings.map((l) => {
              const ok = affordable(l);
              return (
                <li
                  key={l.outpoint}
                  className={`grid grid-cols-[1fr_auto_4.5rem_8.5rem] items-center gap-3 px-3 py-2.5 ${ok ? "" : "opacity-45"}`}
                >
                  <div className="flex min-w-0 items-center gap-2">
                    {l.image && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={l.image} alt="" className="h-8 w-8 shrink-0 rounded-md object-cover" loading="lazy" />
                    )}
                    <span className="truncate text-sm font-medium">{l.label}</span>
                    {l.count > 1 && <span className="shrink-0 text-xs text-muted">×{l.count}</span>}
                  </div>
                  <span className="text-right text-sm tabular-nums text-gold">{sats(l.priceSats)}</span>
                  <span className="text-right text-sm tabular-nums">{usd ? formatUsd(l.priceSats, usd) : "–"}</span>
                  <div className="flex justify-end">
                    <ListingAction listing={l} affordable={ok} busy={busy} marketUrl={props.marketUrl} onBuy={() => buy(l)} />
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {usd && (
        <p className="mt-2 text-xs text-muted">
          Dollar prices are estimates at ${usd.toFixed(2)} per BSV, before network fees.
        </p>
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
  const base = "shrink-0 whitespace-nowrap rounded-full px-4 py-1.5 text-sm transition";
  if (!affordable) {
    return (
      <span className={`${base} cursor-not-allowed border border-line text-muted`} title="More than your balance or budget">
        Too expensive
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
        1sat.market ↗
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
