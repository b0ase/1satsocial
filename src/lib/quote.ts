// Exact terms of an in-app purchase, read from the listing's own locking script, for the approval panel.
import { LockingScript, Transaction, Utils } from "@bsv/sdk";
import { OrdLock, OrdLockV2 } from "@1sat/templates";
import { tokenIndexing, verifyListing } from "./overlay";
import type { RoomRef } from "./room-ref";

const ONESAT = process.env.ONESAT_API_URL || "https://api.1sat.app/1sat";

// Calibrated on a real Yours v5 OrdLock purchase: 2,396 bytes for 322 sats (~134 sat/kB).
const FEE_SATS_PER_KB = 150;
const EST_TX_BYTES = { bsv21: 2_450, coll: 2_100 } as const;

export type QuoteLine = { label: string; address: string | null; sats: number; note?: string };

export type Quote = {
  outpoint: string;
  listingVersion: "v1" | "v2";
  lines: QuoteLine[]; // what leaves your wallet
  receive: string; // what you get
  estNetworkFeeSats: number;
  totalSats: number; // lines + network fee estimate
  walletPrompts: string[];
  warnings: string[];
};

function p2pkhAddress(script: LockingScript): string | null {
  const c = script.chunks;
  if (c.length === 5 && c[0].op === 0x76 && c[1].op === 0xa9 && c[2].data?.length === 20 && c[3].op === 0x88 && c[4].op === 0xac) {
    return Utils.toBase58Check(c[2].data);
  }
  return null;
}

export async function quoteListing(
  room: RoomRef,
  opts: { outpoint: string; label: string; chatOnly: boolean; marketFee?: { address: string; rate: number } },
): Promise<Quote | { error: string }> {
  const [txid, voutStr] = opts.outpoint.replace(".", "_").split("_");
  const vout = Number(voutStr);
  if (!/^[0-9a-f]{64}$/.test(txid ?? "") || !Number.isInteger(vout)) return { error: "Bad listing" };

  if (room.kind === "bsv21" && opts.chatOnly) {
    const v = await verifyListing(room.id, opts.outpoint);
    if (!v.ok) return { error: v.reason === "already-sold" ? "That listing has just been sold." : "That listing is no longer available." };
  }

  // The payout is enforced by the listing script itself, so read it from there rather than trusting an index.
  const res = await fetch(`${ONESAT}/beef/${txid}/tx`, { signal: AbortSignal.timeout(15_000), cache: "no-store" });
  if (!res.ok) return { error: "Couldn't load the listing transaction" };
  const tx = Transaction.fromBinary(Array.from(new Uint8Array(await res.arrayBuffer())));
  const lock = tx.outputs[vout]?.lockingScript;
  if (!lock) return { error: "Listing output not found" };
  const v2 = OrdLockV2.decode(lock);
  const data = v2 ?? OrdLock.decode(lock);
  if (!data) return { error: "Not a marketplace listing" };

  const r = new Utils.Reader(data.payout);
  const payoutSats = r.readUInt64LEBn().toNumber();
  const payoutScript = LockingScript.fromBinary(r.read(r.readVarIntNum()));

  const lines: QuoteLine[] = [
    { label: "Payment to seller", address: p2pkhAddress(payoutScript), sats: payoutSats, note: "Fixed by the listing contract" },
  ];
  if (opts.marketFee && opts.marketFee.rate > 0) {
    lines.push({ label: "Marketplace fee", address: opts.marketFee.address, sats: Math.ceil(payoutSats * opts.marketFee.rate) });
  }
  if (room.kind === "bsv21") {
    const ix = await tokenIndexing(room.id);
    if (ix?.active) {
      lines.push({ label: "1Sat overlay indexing fee", address: ix.feeAddress, sats: ix.feePerOutput, note: "Added by the SDK for active tokens" });
    }
  }

  const kind = room.kind === "coll" ? "coll" : "bsv21";
  const estNetworkFeeSats = Math.ceil((EST_TX_BYTES[kind] / 1000) * FEE_SATS_PER_KB);
  const warnings: string[] = [];
  if (opts.chatOnly) {
    warnings.push(
      "Chat access only: GorillaPool verifies these are genuine tokens, but the 1Sat overlay that Yours relies on hasn't indexed their history. They'll get you into this room, but Yours may not show them or let you send or resell them until that history is indexed.",
    );
  }
  warnings.push("Blockchain payments are final. Once your wallet broadcasts this transaction it can't be reversed.");

  return {
    outpoint: `${txid}_${vout}`,
    listingVersion: v2 ? "v2" : "v1",
    lines,
    receive: `${opts.label}, delivered to a new key in your Yours Wallet`,
    estNetworkFeeSats,
    totalSats: lines.reduce((s, l) => s + l.sats, 0) + estNetworkFeeSats,
    walletPrompts: [
      "Payment: approve the transaction in Yours (pays the lines above plus the network fee).",
      "Holdings check: Yours then asks you to sign a login message with each key that holds your assets. These are signatures only; they don't move funds.",
    ],
    warnings,
  };
}
