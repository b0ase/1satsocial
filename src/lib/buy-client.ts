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
          labels: args?.labels,
          inputShape: (args?.inputs as Record<string, unknown>[] | undefined)?.map((i) => ({
            keys: Object.keys(i),
            unlockingScriptLength: i.unlockingScriptLength,
          })),
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

// An OrdLock purchase unlock embeds every output after the payout, including the wallet's change.
// The SDK sizes it for a bare transaction (1,402 bytes for v1), but Yours splits change across
// ~8 outputs, pushing the real unlock to ~1,670 bytes, which the wallet rejects as oversized.
// Declared lengths are an upper bound, so padding only raises the fee estimate slightly.
const ORDLOCK_UNLOCK_MIN = 1_000;
const CHANGE_HEADROOM_BYTES = 34 * 32;

function withUnlockHeadroom(wallet: WalletInterface): WalletInterface {
  return new Proxy(wallet, {
    get(target, prop, receiver) {
      const orig = Reflect.get(target, prop, receiver);
      if (prop !== "createAction" || typeof orig !== "function") return orig;
      return (args: Record<string, unknown>, ...rest: unknown[]) => {
        const inputs = args?.inputs as { unlockingScriptLength?: number }[] | undefined;
        const padded = inputs?.map((i) =>
          (i.unlockingScriptLength ?? 0) >= ORDLOCK_UNLOCK_MIN
            ? { ...i, unlockingScriptLength: i.unlockingScriptLength! + CHANGE_HEADROOM_BYTES }
            : i,
        );
        return orig.call(target, padded ? { ...args, inputs: padded } : args, ...rest);
      };
    },
  });
}

function report(data: object) {
  if (process.env.NODE_ENV === "production") return;
  fetch("/api/debug", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data) }).catch(() => {});
}

export type BuyRequest = {
  kind: RoomKind;
  roomId: string;
  outpoint: string;
  amount: string | null;
  /**
   * The listing isn't in the 1Sat overlay (its history was never submitted there), so validate it
   * against GorillaPool instead. The tokens are real, but Yours may not show or send them until
   * the overlay indexes their history.
   */
  chatOnly?: boolean;
};

/** OneSatServices whose BSV-21 listing check asks GorillaPool (via our server) instead of the overlay. */
function indexerValidatedServices(services: OneSatServices): OneSatServices {
  const bsv21 = new Proxy(services.bsv21, {
    get(target, prop, receiver) {
      if (prop === "validateOutput") {
        return async (tokenId: string, outpoint: string) => {
          const res = await fetch(`/api/listings/verify?tokenId=${tokenId}&outpoint=${encodeURIComponent(outpoint)}`);
          const v = (await res.json()) as { ok: boolean; reason?: string };
          if (!v.ok) throw new Error(`listing-check-failed:${v.reason}`);
          return { outpoint };
        };
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return new Proxy(services, {
    get(target, prop, receiver) {
      return prop === "bsv21" ? bsv21 : Reflect.get(target, prop, receiver);
    },
  });
}

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
  "listing-check-failed:already-sold": "That listing has just been sold.",
  "listing-check-failed:not-a-listing": "That listing is no longer available.",
  "module-left-signable-transaction": "Yours could not complete this purchase. It has been logged for debugging.",
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
    const base = new OneSatServices("main");
    const services = req.chatOnly && req.kind === "bsv21" ? indexerValidatedServices(base) : base;
    const ctx = createContext(withUnlockHeadroom(traced(conn.wallet, calls)), { services, chain: "main" });
    const attempt = async (viaWalletModule: boolean): Promise<{ txid?: string; error?: string }> => {
      const route = viaWalletModule ? { usePermissionModule: true, permissionScheme: req.kind === "coll" ? "1sat" : "bsv21" } as const : {};
      try {
        return req.kind === "coll"
          ? await buyOrdinal.execute(ctx, { outpoint, ...fee, ...route })
          : req.kind === "bsv21" && req.amount
            ? await buyBsv21.execute(ctx, { tokenId: req.roomId, outpoint, amount: req.amount, ...fee, ...route })
            : { error: "BSV-20 tick purchases aren't supported in-app yet" };
      } catch (e) {
        return { error: e instanceof Error ? e.message : String(e) };
      }
    };

    // Yours v5 builds OrdLock purchase unlocks itself through its 1Sat permission module; the plain
    // SDK route fails inside Yours ("inputs[0].unlockScript parameter must be valid"). Use the module
    // route first and fall back to the SDK route for wallets without the module.
    let route = "wallet-module";
    let result = await attempt(true);
    if (result.error === "module-left-signable-transaction") {
      route = "sdk";
      result = await attempt(false);
    }
    report({ kind: "buy", provider: conn.provider, route, req, result: { txid: result.txid, error: result.error }, calls });
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
