"use client";

import { useEffect, useState } from "react";
import { downloadAgreementPdf, fingerprint, type Agreement, type SignedAgreement } from "@/lib/agreement";

export type Terms = Omit<Agreement, "approvedAt" | "approver">;

function sats(n: number) {
  return n === 1 ? "1 sat" : `${n.toLocaleString("en-US")} sats`;
}
function usd(n: number, rate: number | null) {
  if (!rate) return null;
  const v = (n / 1e8) * rate;
  if (v > 0 && v < 0.01) return "<$0.01";
  return v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
}

/**
 * Pre-wallet approval step. Shows every payment line with its recipient, the estimated total, which
 * Yours prompts will follow, and the risks. Approving downloads a fingerprinted PDF of these terms.
 */
export function ApprovalPanel(props: {
  loadTerms: () => Promise<Terms | { error: string }>;
  approver: string | null;
  approveLabel: string;
  onApprove: (signed: SignedAgreement) => void;
  onClose: () => void;
}) {
  const { loadTerms } = props;
  const [terms, setTerms] = useState<Terms | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [working, setWorking] = useState(false);

  useEffect(() => {
    let live = true;
    loadTerms()
      .then((t) => {
        if (!live) return;
        if ("error" in t) setError(t.error);
        else setTerms(t);
      })
      .catch(() => live && setError("Couldn't load the terms. Try again."));
    return () => {
      live = false;
    };
  }, [loadTerms]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !working && props.onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [props, working]);

  async function approve() {
    if (!terms) return;
    setWorking(true);
    try {
      const signed = await fingerprint({ ...terms, approvedAt: new Date().toISOString(), approver: props.approver });
      await downloadAgreementPdf(signed); // the record of what was agreed, before the wallet is asked
      props.onApprove(signed);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't create the approval record");
      setWorking(false);
    }
  }

  const rate = terms?.usdPerBsv ?? null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="approval-title"
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={(e) => e.target === e.currentTarget && !working && props.onClose()}
    >
      <div className="flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl border border-line bg-panel text-left sm:rounded-2xl">
        <div className="border-b border-line px-5 py-4">
          <p className="text-xs uppercase tracking-wide text-muted">Review before your wallet opens</p>
          <h2 id="approval-title" className="mt-1 text-lg font-semibold">
            {terms?.title ?? "Loading terms…"}
          </h2>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4 text-sm">
          {error && <p className="rounded-lg border border-red-900/60 bg-red-950/30 px-3 py-2 text-red-300">{error}</p>}
          {!terms && !error && <div className="h-40 animate-pulse rounded-lg bg-panel-2" />}

          {terms && (
            <>
              {terms.receive && (
                <section>
                  <h3 className="mb-1 text-xs uppercase tracking-wide text-muted">You receive</h3>
                  <p>{terms.receive}</p>
                </section>
              )}

              <section>
                <h3 className="mb-2 text-xs uppercase tracking-wide text-muted">Your wallet pays</h3>
                <ul className="divide-y divide-line rounded-lg border border-line bg-panel-2">
                  {terms.lines.map((l) => (
                    <li key={l.label} className="px-3 py-2.5">
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="font-medium">{l.label}</span>
                        <span className="shrink-0 tabular-nums text-gold">
                          {sats(l.sats)}
                          {usd(l.sats, rate) && <span className="ml-2 text-muted">{usd(l.sats, rate)}</span>}
                        </span>
                      </div>
                      {l.address && <p className="mt-0.5 break-all font-mono text-xs text-muted">to {l.address}</p>}
                      {l.note && <p className="mt-0.5 text-xs text-muted">{l.note}</p>}
                    </li>
                  ))}
                  <li className="flex items-baseline justify-between gap-3 px-3 py-2.5">
                    <span>
                      Network fee <span className="text-muted">(estimate, set by your wallet)</span>
                    </span>
                    <span className="shrink-0 tabular-nums">
                      {sats(terms.estNetworkFeeSats)}
                      {usd(terms.estNetworkFeeSats, rate) && <span className="ml-2 text-muted">{usd(terms.estNetworkFeeSats, rate)}</span>}
                    </span>
                  </li>
                  <li className="flex items-baseline justify-between gap-3 px-3 py-2.5 font-semibold">
                    <span>Total (estimate)</span>
                    <span className="shrink-0 tabular-nums text-gold">
                      {sats(terms.totalSats)}
                      {usd(terms.totalSats, rate) && <span className="ml-2 font-normal text-muted">{usd(terms.totalSats, rate)}</span>}
                    </span>
                  </li>
                </ul>
                {rate && <p className="mt-1 text-xs text-muted">Dollar amounts at ${rate.toFixed(2)} per BSV.</p>}
              </section>

              <section>
                <h3 className="mb-1 text-xs uppercase tracking-wide text-muted">What Yours will ask you to approve</h3>
                <ol className="list-decimal space-y-1 pl-5">
                  {terms.walletPrompts.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ol>
                <p className="mt-1 text-xs text-muted">
                  If a Yours window is cut off, resize or scroll it: the approve button is at the bottom.
                </p>
              </section>

              {terms.warnings.length > 0 && (
                <section className="rounded-lg border border-yellow-900/60 bg-yellow-950/20 px-3 py-2.5">
                  <h3 className="mb-1 text-xs uppercase tracking-wide text-yellow-200/80">Important</h3>
                  <ul className="list-disc space-y-1 pl-5 text-yellow-100/90">
                    {terms.warnings.map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                </section>
              )}

              <section>
                <h3 className="mb-1 text-xs uppercase tracking-wide text-muted">References</h3>
                {Object.entries(terms.reference).map(([k, v]) => (
                  <p key={k} className="break-all font-mono text-xs text-muted">
                    {k}: {v}
                  </p>
                ))}
              </section>
            </>
          )}
        </div>

        <div className="border-t border-line bg-panel px-5 py-4">
          <label className="mb-3 flex cursor-pointer items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
              disabled={!terms}
              className="mt-0.5 accent-[var(--gold)]"
            />
            <span>
              I&apos;ve reviewed these terms. A PDF record of them downloads when I approve, then Yours opens for my signature.
            </span>
          </label>
          <div className="flex justify-end gap-2">
            <button onClick={props.onClose} disabled={working} className="rounded-full border border-line px-4 py-2 text-sm hover:border-muted">
              Cancel
            </button>
            <button
              onClick={approve}
              disabled={!terms || !agreed || working}
              className="rounded-full bg-gold px-5 py-2 text-sm font-medium text-black transition hover:brightness-110 disabled:opacity-40"
            >
              {working ? "Saving record…" : props.approveLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
