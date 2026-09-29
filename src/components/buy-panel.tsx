"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ApprovalPanel, type Terms } from "@/components/approval-panel";
import { downloadAgreementPdf, type SignedAgreement } from "@/lib/agreement";
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

type Receipt = {
  txid: string;
  roomId: string;
  label: string;
  priceSats: number;
  usd: string | null;
  chatOnly: boolean;
  at: string;
  /** The terms the buyer approved; re-rendered with the txid as the receipt PDF. */
  agreement?: SignedAgreement;
};

const RECEIPTS_KEY = "ss_receipts";
const ACCESS_POLL_MS = 15_000;
const ACCESS_POLL_FOR_MS = 30 * 60_000;

// Receipts are a per-browser convenience so a reload doesn't lose proof of purchase; the chain is the record.
function loadReceipts(): Receipt[] {
  try {
    return JSON.parse(localStorage.getItem(RECEIPTS_KEY) ?? "[]") as Receipt[];
  } catch {
    return [];
  }
}

function saveReceipt(r: Receipt) {
  try {
    localStorage.setItem(RECEIPTS_KEY, JSON.stringify([r, ...loadReceipts()].slice(0, 50)));
  } catch {
    /* storage unavailable */
  }
}

export function BuyPanel(props: {
  kind: RoomKind;
  roomId: string;
  title: string;
  listings: Listing[];
  floorLabel: string | null;
  marketUrl: string;
  messagesApi: string;
  signedIn: boolean;
  /** Session user id (identity key or ordinals address), recorded on the approval PDF. */
  userId: string | null;
  /** USD per BSV for estimates; null if no price source was reachable. */
  usdPerBsv: number | null;
}) {
  const router = useRouter();
  const usd = props.usdPerBsv;
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [balance, setBalance] = useState<number | null | "loading">(props.signedIn ? "loading" : null);
  // Fallback when the wallet won't share its balance: the viewer types a budget in dollars.
  const [budgetUsd, setBudgetUsd] = useState("");
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [waiting, setWaiting] = useState(false);

  const claimApi = props.messagesApi.replace(/\/messages$/, "/claim");

  // Instant access: the server verifies the purchase transaction itself instead of waiting for a block.
  const claim = useCallback(
    async (txid: string): Promise<boolean> => {
      const res = await fetch(claimApi, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ txid }),
      }).catch(() => null);
      return !!res?.ok;
    },
    [claimApi],
  );

  // Restore receipts for this room. A recent purchase claims instant access, else keeps waiting for the indexer.
  useEffect(() => {
    const mine = loadReceipts().filter((r) => r.roomId === props.roomId);
    if (!mine.length) return;
    let live = true;
    queueMicrotask(async () => {
      setReceipts(mine);
      const recent = mine.filter((r) => Date.now() - Date.parse(r.at) < 6 * 3_600_000);
      if (!recent.length || !props.signedIn) return;
      for (const r of recent) {
        if (await claim(r.txid)) {
          if (live) router.refresh();
          return;
        }
      }
      if (live) setWaiting(true);
    });
    return () => {
      live = false;
    };
  }, [props.roomId, props.signedIn, claim, router]);

  // After a purchase, keep checking until the indexer sees it (usually the next block, ~10 min).
  useEffect(() => {
    if (!waiting) return;
    const started = Date.now();
    const timer = setInterval(async () => {
      if (Date.now() - started > ACCESS_POLL_FOR_MS) {
        clearInterval(timer);
        setWaiting(false);
        return;
      }
      const res = await fetch(props.messagesApi).catch(() => null);
      if (res?.ok) {
        clearInterval(timer);
        setWaiting(false);
        router.refresh();
      }
    }, ACCESS_POLL_MS);
    return () => clearInterval(timer);
  }, [waiting, props.messagesApi, router]);

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

  const [pending, setPending] = useState<Listing | null>(null);

  const loadTerms = useCallback(async (): Promise<Terms | { error: string }> => {
    const l = pending;
    if (!l) return { error: "Nothing to approve" };
    const q = new URLSearchParams({
      kind: props.kind,
      id: props.roomId,
      outpoint: l.outpoint,
      label: l.label,
      chatOnly: l.chatOnly ? "1" : "0",
    });
    const res = await fetch(`/api/listings/quote?${q}`);
    const quote = await res.json();
    if (!res.ok || quote.error) return { error: quote.error ?? "Couldn't price this listing" };
    return {
      kind: "purchase",
      title: `Buy ${l.label}`,
      site: window.location.host,
      room: { name: props.title, kind: props.kind, id: props.roomId, url: window.location.href },
      reference: {
        Listing: quote.outpoint,
        "Listing contract": `OrdLock ${quote.listingVersion}`,
        [props.kind === "coll" ? "Collection" : "Token"]: props.roomId,
        Validation: l.chatOnly ? "GorillaPool (not in the 1Sat overlay)" : "1Sat overlay",
      },
      receive: quote.receive,
      lines: quote.lines,
      estNetworkFeeSats: quote.estNetworkFeeSats,
      totalSats: quote.totalSats,
      usdPerBsv: usd,
      walletPrompts: quote.walletPrompts,
      warnings: quote.warnings,
      terms: [
        "The payment to the seller is fixed by the listing's on-chain contract; 1satsocial never holds your funds.",
        "Your wallet shows the final transaction, including its exact network fee, before you sign it. If it differs from these terms, reject it in Yours.",
        "Room access is granted while you hold the token and is checked against the chain; selling the token ends access.",
      ],
    };
  }, [pending, props.kind, props.roomId, props.title, usd]);

  function buy(l: Listing) {
    setError(null);
    setPending(l);
  }

  async function executeBuy(l: Listing, agreement: SignedAgreement) {
    setBusy(l.outpoint);
    setError(null);
    try {
      setStatus("Confirm the purchase in Yours…");
      const { buyListing } = await import("@/lib/buy-client");
      const id = await buyListing({
        kind: props.kind,
        roomId: props.roomId,
        outpoint: l.outpoint,
        amount: l.amount,
        chatOnly: l.chatOnly,
      });
      const receipt: Receipt = {
        txid: id,
        roomId: props.roomId,
        label: l.label,
        priceSats: l.priceSats,
        usd: usd ? formatUsd(l.priceSats, usd) : null,
        chatOnly: l.chatOnly,
        at: new Date().toISOString(),
        agreement,
      };
      saveReceipt(receipt);
      setReceipts((r) => [receipt, ...r]);
      setStatus(null);

      // Re-prove holdings so the server sees the key the new token landed on. The purchase is already
      // on-chain, so a failure here isn't fatal: Refresh holdings later picks the key up.
      try {
        await signIn(setStatus);
      } catch {
        /* receipt stands; access check below keeps running */
      }

      // Instant access from the transaction itself; the broadcaster can take a moment to report it.
      setStatus("Verifying your purchase on the network…");
      for (let i = 0; i < 6; i++) {
        if (await claim(id)) {
          setStatus("You're in.");
          router.refresh();
          return;
        }
        await new Promise((r) => setTimeout(r, 2_000));
      }
      setStatus(null);
      setWaiting(true);
    } catch (e) {
      setStatus(null);
      setError(e instanceof Error ? e.message : "Purchase failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="w-full max-w-2xl text-left">
      {pending && (
        <ApprovalPanel
          loadTerms={loadTerms}
          approver={props.userId}
          approveLabel="Approve & open Yours"
          onClose={() => setPending(null)}
          onApprove={(signed) => {
            const l = pending;
            setPending(null);
            void executeBuy(l, signed);
          }}
        />
      )}
      {receipts.map((r) => (
        <div key={r.txid} className="mb-4 rounded-xl border border-gold/40 bg-gold-soft p-4 text-sm">
          <div className="flex items-center justify-between gap-3">
            <p className="font-medium text-gold">Purchase complete</p>
            <span className="text-xs text-muted">{new Date(r.at).toLocaleString()}</span>
          </div>
          <p className="mt-1">
            You bought <span className="font-medium">{r.label}</span> for {sats(r.priceSats)}
            {r.usd ? ` (${r.usd})` : ""}, plus network fees.
          </p>
          <p className="mt-2 text-muted">
            {waiting
              ? "We couldn't verify it instantly, so we're waiting for the next block (usually about 10 minutes). You'll be let in automatically."
              : "If the room hasn't opened yet, choose Refresh holdings in the account menu."}
            {r.chatOnly && " These are chat-access tokens, so Yours may not show them yet."}
          </p>
          <a
            href={`https://whatsonchain.com/tx/${r.txid}`}
            target="_blank"
            rel="noreferrer"
            className="mt-2 inline-block break-all text-xs text-muted underline hover:text-text"
          >
            Receipt on-chain: {r.txid}
          </a>
          {r.agreement && (
            <button
              onClick={() => downloadAgreementPdf({ ...r.agreement!, txid: r.txid })}
              className="mt-2 block rounded-full border border-gold/50 px-3 py-1 text-xs text-gold hover:bg-gold-soft"
            >
              Download receipt (PDF)
            </button>
          )}
        </div>
      ))}

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
      {props.listings.some((l) => l.chatOnly) && (
        <p className="mt-1 text-xs text-muted">
          <span className="text-gold">Buy · chat only</span>: genuine tokens verified by GorillaPool, but not yet indexed by
          the 1Sat overlay, so Yours may not show or send them until it catches up.
        </p>
      )}

      {status && <p className="mt-3 text-sm text-gold">{status}</p>}
      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
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
  if (l.chatOnly) {
    return (
      <button
        onClick={props.onBuy}
        disabled={!!props.busy}
        title="Genuine tokens (verified by GorillaPool) that Yours may not display until the 1Sat overlay indexes them"
        className={`${base} border border-gold/60 text-gold hover:bg-gold-soft disabled:opacity-50`}
      >
        {props.busy === l.outpoint ? "Buying…" : "Buy · chat only"}
      </button>
    );
  }
  if (!l.buyable) {
    // BSV-20 ticks: the SDK has no purchase action for them.
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
