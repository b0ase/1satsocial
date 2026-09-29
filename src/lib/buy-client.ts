"use client";

// Buying a listing with the user's wallet. Loaded on demand (it pulls in the 1Sat SDK).
import { connectWallet } from "@1sat/connect";
import { buyBsv21, buyOrdinal, createContext } from "@1sat/actions";
import { OneSatServices } from "@1sat/client";
import { Beef, type WalletInterface } from "@bsv/sdk";
import type { RoomKind } from "./room-ref";

// Dev-only tracing of wallet calls during a purchase, to debug the Yours v5 inputBEEF error.
function describeBeef(v: unknown) {
  if (v == null) return null;
  const type = Object.prototype.toString.call(v);
  const len = (v as { length?: number }).length ?? Object.keys(v as object).length;
  try {
    const b = Beef.fromBinary(Array.from(v as ArrayLike<number>));
    return { type, len, version: Array.from((v as ArrayLike<number>) ?? []).slice(0, 4), txs: b.txs.map((t) => t.txid), bumps: b.bumps.length };
  } catch (e) {
    return { type, len, parseError: String(e) };
  }
}

function traced(wallet: WalletInterface, log: object[]): WalletInterface {
  if (process.env.NODE_ENV === "production") return wallet;
  return new Proxy(wallet, {
    get(target, prop, receiver) {
      const orig = Reflect.get(target, prop, receiver);
      if (typeof orig !== "function" || !["createAction", "signAction"].includes(String(prop))) return orig;
      return async (args: Record<string, unknown>, ...rest: unknown[]) => {
        const entry: Record<string, unknown> = {
          method: prop,
          inputBEEF: describeBeef(args?.inputBEEF),
          inputs: (args?.inputs as { outpoint?: string }[] | undefined)?.map((i) => i.outpoint),
          spends: args?.spends ? Object.keys(args.spends as object) : undefined,
          options: args?.options,
          originator: rest[0],
        };
        log.push(entry);
        try {
          const r = await orig.call(target, args, ...rest);
          entry.ok = true;
          return r;
        } catch (e) {
          entry.error = String(e);
          throw e;
        }
      };
    },
  });
}

function report(data: object) {
  if (process.env.NODE_ENV === "production") return;
  fetch("/api/debug", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data) }).catch(() => {});
}

export type BuyRequest = { kind: RoomKind; roomId: string; outpoint: string; amount: string | null };

// Optional marketplace fee paid to the app operator on each in-app purchase (e.g. 0.02 = 2%).
const fee = {
  marketplaceAddress: process.env.NEXT_PUBLIC_MARKET_FEE_ADDRESS || undefined,
  marketplaceRate: Number(process.env.NEXT_PUBLIC_MARKET_FEE_RATE) || undefined,
};

const ERRORS: Record<string, string> = {
  "listing-not-found-in-overlay": "That listing is no longer available.",
  "listing-transaction-not-found": "That listing is no longer available.",
  "not-an-ordlock-listing": "That listing is no longer available.",
  "services-required-for-purchase": "Marketplace service unavailable. Try again.",
};

function friendly(error: string) {
  if (/insufficient/i.test(error)) return "Not enough BSV in your wallet for this purchase.";
  if (/denied|reject|cancel/i.test(error)) return "Purchase cancelled in wallet.";
  return ERRORS[error] ?? error;
}

/** Buy a listing. Resolves with the txid once the wallet has signed and broadcast. */
export async function buyListing(req: BuyRequest): Promise<string> {
  const conn = await connectWallet().catch(() => null);

  if (conn) {
    // BRC-100 wallets expect "txid.vout"; the indexer uses "txid_vout". Yours rejects the latter
    // with a misleading "inputBEEF ... 0 Transactions" error because it can't match the input.
    const outpoint = req.outpoint.replace("_", ".");
    const calls: object[] = [];
    const ctx = createContext(traced(conn.wallet, calls), { services: new OneSatServices("main"), chain: "main" });
    let result: { txid?: string; error?: string };
    try {
      result =
        req.kind === "coll"
          ? await buyOrdinal.execute(ctx, { outpoint, ...fee })
          : req.kind === "bsv21" && req.amount
            ? await buyBsv21.execute(ctx, {
                tokenId: req.roomId,
                outpoint,
                amount: req.amount,
                ...fee,
              })
            : { error: "BSV-20 tick purchases aren't supported in-app yet" };
    } catch (e) {
      result = { error: e instanceof Error ? e.message : String(e) };
    }
    report({ kind: "buy", provider: conn.provider, req, result: { txid: result.txid, error: result.error }, calls });
    if (result.error || !result.txid) throw new Error(friendly(result.error ?? "Purchase failed"));
    return result.txid;
  }

  // Legacy injected provider (pre-v5 Yours).
  const yours = window.yours;
  if (yours?.isReady) {
    await yours.connect();
    const params = { outpoint: req.outpoint, ...fee };
    const txid = req.kind === "coll" ? await yours.purchaseOrdinal(params) : await yours.purchaseBsv20(params);
    if (!txid) throw new Error("Purchase cancelled in wallet.");
    return txid;
  }

  throw new Error("Yours Wallet not detected.");
}
