"use client";

import { connectWallet } from "@1sat/connect";
import type { WalletInterface } from "@bsv/sdk";

declare global {
  interface Window {
    CWI?: unknown;
  }
}

export type WalletConnection = { wallet: WalletInterface; identityKey: string; provider: string };

/**
 * Connect to the user's BRC-100 wallet.
 *
 * Yours injects `window.CWI`, a BRC-100 wallet object; call it directly.
 * - `connectWallet()`'s auto-detect also probes localhost ports for desktop wallets, which on an https site makes
 *   Chrome ask for permission to "access other apps and services on this device".
 * - @bsv/sdk >= 2.8's WalletClient / WindowCWISubstrate strictly validate results, and reject what Yours returns
 *   when its 1Sat module completes a purchase we requested with deferred signing ("Invalid createAction result
 *   signableTransaction: expected the requested deferred-signing transaction").
 * Only fall back to auto-detect when no extension is present.
 */
export async function connectBrc100(): Promise<WalletConnection | null> {
  if (typeof window !== "undefined" && typeof window.CWI === "object" && window.CWI) {
    const wallet = window.CWI as WalletInterface;
    const { publicKey } = await wallet.getPublicKey({ identityKey: true });
    return { wallet, identityKey: publicKey, provider: "window.CWI" };
  }
  const res = await connectWallet().catch(() => null);
  return res ? { wallet: res.wallet, identityKey: res.identityKey, provider: res.provider } : null;
}
