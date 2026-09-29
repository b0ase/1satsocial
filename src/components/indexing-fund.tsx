"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Indexing } from "@/lib/overlay";
import { formatUsd } from "@/lib/price";

const PRESETS_USD = [0.25, 1, 5];

function sats(n: number) {
  return `${Math.round(n).toLocaleString("en-US")} sats`;
}

export function IndexingFund(props: { symbol: string; indexing: Indexing; usdPerBsv: number | null }) {
  const router = useRouter();
  const { indexing: ix, usdPerBsv: usd } = props;
  const [open, setOpen] = useState(!ix.active);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string; txid?: string } | null>(null);

  const outputsLeft = Math.floor(ix.balanceSats / ix.feePerOutput);
  const debt = ix.balanceSats < 0 ? -ix.balanceSats : 0;

  async function fund(amountUsd: number) {
    if (!usd) return;
    const amount = Math.max(1000, Math.round((amountUsd / usd) * 1e8));
    const ok = window.confirm(
      `Send ${sats(amount)} (about ${formatUsd(amount, usd)}) to ${props.symbol}'s indexing fund?\n\n` +
        `Fee address: ${ix.feeAddress}\nThis is a donation to keep the token indexed. It isn't refundable.`,
    );
    if (!ok) return;
    setBusy(true);
    setMsg(null);
    try {
      const { fundIndexing } = await import("@/lib/fund-client");
      const txid = await fundIndexing(ix.feeAddress, amount, props.symbol);
      setMsg({ ok: true, text: "Thanks! The overlay credits the fund once it sees your payment.", txid });
      setTimeout(() => router.refresh(), 15_000);
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Payment failed" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`mb-4 rounded-xl border px-4 py-3 text-sm ${ix.active ? "border-line bg-panel" : "border-yellow-900/70 bg-yellow-950/20"}`}>
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between gap-3 text-left">
        <span className="flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full ${ix.active ? "bg-emerald-400" : "bg-yellow-400"}`} />
          <span className="font-medium">{ix.active ? "Indexing active" : "Indexing paused"}</span>
          <span className="text-muted">
            {ix.active
              ? `· fund covers ~${outputsLeft.toLocaleString()} more transfers`
              : `· fund is ${sats(debt)}${usd ? ` (${formatUsd(debt, usd)})` : ""} short`}
          </span>
        </span>
        <span className="text-muted">{open ? "Hide" : "Fund it"}</span>
      </button>

      {open && (
        <div className="mt-3 border-t border-line pt-3">
          <p className="text-muted">
            The 1Sat overlay that Yours Wallet relies on charges {ix.feePerOutput.toLocaleString()} sats to index each{" "}
            {props.symbol} transfer, paid from a fund anyone can top up.{" "}
            {ix.active
              ? "While the fund lasts, new transfers show up in Yours and can be bought in-app."
              : "The fund has run out, so new transfers aren't being indexed. Holders' wallets may not see recent trades, and new listings can't be bought in-app."}
          </p>
          {usd ? (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {!ix.active && debt > 0 && (
                <button
                  onClick={() => fund(((debt + 100 * ix.feePerOutput) / 1e8) * usd)}
                  disabled={busy}
                  className="rounded-full bg-gold px-4 py-1.5 font-medium text-black hover:brightness-110 disabled:opacity-50"
                >
                  Clear the shortfall ({formatUsd(debt + 100 * ix.feePerOutput, usd)})
                </button>
              )}
              {PRESETS_USD.map((d) => (
                <button
                  key={d}
                  onClick={() => fund(d)}
                  disabled={busy}
                  className="rounded-full border border-gold/50 px-4 py-1.5 text-gold hover:bg-gold-soft disabled:opacity-50"
                >
                  Add ${d < 1 ? d.toFixed(2) : d}
                </button>
              ))}
            </div>
          ) : (
            <p className="mt-2 text-muted">Price unavailable right now, so funding is paused. Try again shortly.</p>
          )}
          <p className="mt-3 break-all text-xs text-muted">
            Fee address{" "}
            <a href={`https://whatsonchain.com/address/${ix.feeAddress}`} target="_blank" rel="noreferrer" className="underline">
              {ix.feeAddress}
            </a>{" "}
            · confirmed by both the 1Sat overlay and GorillaPool
          </p>
          {msg && (
            <p className={`mt-2 ${msg.ok ? "text-gold" : "text-red-400"}`}>
              {msg.text}{" "}
              {msg.txid && (
                <a href={`https://whatsonchain.com/tx/${msg.txid}`} target="_blank" rel="noreferrer" className="underline">
                  View tx
                </a>
              )}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
