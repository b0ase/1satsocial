"use client";

// The approval panel is a contract: when the user approves, we record exactly what they agreed to,
// fingerprint it (SHA-256 over the canonical JSON), and download it as a PDF.

export type AgreementLine = { label: string; address: string | null; sats: number; note?: string };

export type Agreement = {
  kind: "purchase" | "indexing-fund";
  title: string;
  site: string;
  approvedAt: string;
  approver: string | null; // identity key or ordinals address from the session
  room: { name: string; kind: string; id: string; url: string };
  reference: Record<string, string>; // listing outpoint, fee address, etc.
  receive: string | null;
  lines: AgreementLine[];
  estNetworkFeeSats: number;
  totalSats: number;
  usdPerBsv: number | null;
  walletPrompts: string[];
  warnings: string[];
  terms: string[];
};

export type SignedAgreement = Agreement & { sha256: string; txid?: string };

/** JSON with object keys sorted at every level, so the fingerprint is reproducible. */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v);
}

export async function fingerprint(a: Agreement): Promise<SignedAgreement> {
  const bytes = new TextEncoder().encode(canonical(a));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const sha256 = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
  return { ...a, sha256 };
}

const sats = (n: number) => `${n.toLocaleString("en-US")} sats`;
function usd(n: number, rate: number | null): string {
  if (!rate) return "";
  const v = (n / 1e8) * rate;
  if (v > 0 && v < 0.01) return " (under $0.01)";
  return ` (about ${v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 })})`;
}

/** Render and download the agreement (or, with a txid, the completed receipt) as a PDF. */
export async function downloadAgreementPdf(a: SignedAgreement): Promise<void> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 48;
  let y = M;

  const ensure = (h: number) => {
    if (y + h > H - M) {
      doc.addPage();
      y = M;
    }
  };
  const text = (s: string, opts: { size?: number; bold?: boolean; color?: number; gap?: number; mono?: boolean } = {}) => {
    doc.setFont(opts.mono ? "courier" : "helvetica", opts.bold ? "bold" : "normal");
    doc.setFontSize(opts.size ?? 10);
    doc.setTextColor(opts.color ?? 20);
    const lines = doc.splitTextToSize(s, W - M * 2) as string[];
    ensure(lines.length * (opts.size ?? 10) * 1.35);
    doc.text(lines, M, y);
    y += lines.length * (opts.size ?? 10) * 1.35 + (opts.gap ?? 4);
  };
  const rule = () => {
    ensure(14);
    doc.setDrawColor(200);
    doc.line(M, y, W - M, y);
    y += 14;
  };

  text(a.txid ? "Purchase receipt" : "Approval record", { size: 9, color: 120 });
  text(a.title, { size: 18, bold: true, gap: 8 });
  text(`${a.site} · approved ${new Date(a.approvedAt).toUTCString()}`, { color: 90 });
  if (a.approver) text(`Approved by wallet identity: ${a.approver}`, { color: 90, mono: true, size: 8 });
  text(`Room: ${a.room.name} (${a.room.kind}) ${a.room.url}`, { color: 90, gap: 10 });
  rule();

  if (a.receive) {
    text("You receive", { bold: true });
    text(a.receive, { gap: 10 });
  }

  text("Your wallet pays", { bold: true });
  for (const l of a.lines) {
    text(`${l.label}: ${sats(l.sats)}${usd(l.sats, a.usdPerBsv)}`);
    if (l.address) text(`  to ${l.address}`, { mono: true, size: 8, color: 80 });
    if (l.note) text(`  ${l.note}`, { size: 8, color: 110 });
  }
  text(`Network fee (estimate, set by your wallet): ${sats(a.estNetworkFeeSats)}${usd(a.estNetworkFeeSats, a.usdPerBsv)}`);
  text(`Total (estimate): ${sats(a.totalSats)}${usd(a.totalSats, a.usdPerBsv)}`, { bold: true, gap: 10 });
  if (a.usdPerBsv) text(`Dollar amounts at $${a.usdPerBsv.toFixed(2)} per BSV at the time of approval.`, { size: 8, color: 110, gap: 10 });

  rule();
  text("References", { bold: true });
  for (const [k, v] of Object.entries(a.reference)) text(`${k}: ${v}`, { mono: true, size: 8, color: 60 });
  if (a.txid) text(`Transaction: ${a.txid} (https://whatsonchain.com/tx/${a.txid})`, { mono: true, size: 8, color: 20 });
  y += 6;

  text("Wallet approvals you'll be asked for", { bold: true });
  a.walletPrompts.forEach((p, i) => text(`${i + 1}. ${p}`, { size: 9 }));
  y += 6;

  if (a.warnings.length) {
    text("Important", { bold: true });
    a.warnings.forEach((w) => text(`• ${w}`, { size: 9 }));
    y += 6;
  }

  text("Terms", { bold: true });
  a.terms.forEach((t) => text(`• ${t}`, { size: 9 }));

  rule();
  text(`Fingerprint (SHA-256 of the agreed terms): ${a.sha256}`, { mono: true, size: 7, color: 110 });
  text("Generated by 1satsocial in your browser. The blockchain transaction is the authoritative record of payment.", {
    size: 7,
    color: 130,
  });

  const stamp = a.approvedAt.replace(/[:.]/g, "-");
  doc.save(`1satsocial-${a.txid ? "receipt" : "approval"}-${stamp}.pdf`);
}
