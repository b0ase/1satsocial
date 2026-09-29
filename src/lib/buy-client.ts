"use client";

// Buying a listing with the user's wallet. Loaded on demand (it pulls in the 1Sat SDK).
import { connectWallet } from "@1sat/connect";
import { buyBsv21, buyOrdinal, createContext } from "@1sat/actions";
import { OneSatServices } from "@1sat/client";
import type { RoomKind } from "./room-ref";

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
    const ctx = createContext(conn.wallet, { services: new OneSatServices("main"), chain: "main" });
    const result =
      req.kind === "coll"
        ? await buyOrdinal.execute(ctx, { outpoint: req.outpoint, ...fee })
        : req.kind === "bsv21" && req.amount
          ? await buyBsv21.execute(ctx, { tokenId: req.roomId, outpoint: req.outpoint, amount: req.amount, ...fee })
          : { error: "BSV-20 tick purchases aren't supported in-app yet" };
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
