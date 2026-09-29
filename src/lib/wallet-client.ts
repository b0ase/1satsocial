"use client";

import { connectBrc100 } from "./wallet-connection";
import { Utils, type WalletInterface, type WalletProtocol } from "@bsv/sdk";
import type { YoursProviderType } from "yours-wallet-provider";
import { LOGIN_KEY_ID, LOGIN_PROTOCOL, MAX_PROOF_OUTPUTS, type LoginProof } from "./login-shared";

declare global {
  interface Window {
    yours?: YoursProviderType;
  }
}

// Wallet baskets that hold 1Sat assets (see @1sat/types: ONESAT_BASKET, BSV21_BASKET, BSV20_BASKET).
// BSV-20 (tick) is no longer supported by current indexers, so only these are read.
const ASSET_BASKETS = ["1sat", "bsv21"];

type Derivation = { protocolID: WalletProtocol; keyID: string; counterparty: string };

// Mirrors ensurePlaintextCi in @1sat/actions (inlined: that barrel pulls WASM into the bundle).
// The wallet normally returns plaintext customInstructions; older records may still be encrypted.
async function plaintextCi(wallet: WalletInterface, value?: string): Promise<string | undefined> {
  if (!value) return undefined;
  try {
    JSON.parse(value);
    return value;
  } catch {
    /* encrypted: fall through */
  }
  try {
    const { plaintext } = await wallet.decrypt({
      ciphertext: Utils.toArray(value, "base64"),
      protocolID: [2, "admin metadata encryption"],
      keyID: "1",
      counterparty: "self",
    });
    return Utils.toUTF8(plaintext);
  } catch {
    return undefined;
  }
}

async function getChallenge(): Promise<string> {
  const res = await fetch("/api/auth/challenge", { method: "POST" });
  if (!res.ok) throw new Error("Could not start sign-in");
  return (await res.json()).message;
}

async function submit(proof: LoginProof) {
  const res = await fetch("/api/auth/verify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(proof),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Sign-in failed");
  return data as { userId: string; addresses: string[]; holdings?: number; warning?: string };
}

const log = (...args: unknown[]) => console.info("[1satsocial]", ...args);

// Sign-in diagnostics, sent to the server (kept in memory, dev only) to debug wallet formats.
const diag: Record<string, unknown> = {};

type AssetOutput = { outpoint: string; derivation: Derivation | null };

/** The outputs this wallet holds in its 1Sat baskets, with the key derivation that locks each (if the wallet says). */
async function assetOutputs(wallet: WalletInterface): Promise<AssetOutput[]> {
  const items: AssetOutput[] = [];
  for (const plain of ASSET_BASKETS) {
    // HandCash's BRC-100 wallet only exposes inventory through permission-scoped baskets ("p 1sat all",
    // "p bsv21 all"); Yours uses the plain names. Try plain first, then the scoped name if that fails or is empty.
    const candidates = [plain, `p ${plain} all`];
    let basket = candidates[0];
    for (const b of candidates) {
      const probe = await wallet.listOutputs({ basket: b, limit: 1 }).catch(() => null);
      if (probe && probe.totalOutputs > 0) {
        basket = b;
        break;
      }
    }
    for (let offset = 0; offset < 5000; offset += 500) {
      let res;
      try {
        res = await wallet.listOutputs({ basket, include: "locking scripts", includeCustomInstructions: true, limit: 500, offset });
      } catch (e) {
        log(`listOutputs(${basket}) failed`, e);
        diag[`basket:${basket}:error`] = String(e);
        break;
      }
      const { outputs, totalOutputs } = res;
      for (const o of outputs) {
        if (o.spendable === false || !o.outpoint) continue;
        let derivation: Derivation | null = null;
        const ci = await plaintextCi(wallet, o.customInstructions);
        try {
          const d = ci ? (JSON.parse(ci) as Partial<Derivation>) : null;
          if (d?.protocolID && d.keyID) derivation = { protocolID: d.protocolID, keyID: d.keyID, counterparty: d.counterparty ?? "self" };
        } catch {
          /* not a derivation record */
        }
        items.push({ outpoint: o.outpoint, derivation });
      }
      diag[`basket:${basket}:${offset}`] = { totalOutputs, returned: outputs.length, withDerivation: items.filter((i) => i.derivation).length };
      if (outputs.length < 500) break;
    }
  }
  return items;
}

async function loginBrc100(wallet: WalletInterface, identityKey: string, onStatus: (s: string) => void) {
  // One approval: the identity signature. Holdings are proved per room (proveRoom), one approval each, the first time.
  const message = await getChallenge();
  onStatus("Approve the sign-in in Yours…");
  const { signature: idSig } = await wallet.createSignature({
    data: Utils.toArray(message, "utf8"),
    protocolID: LOGIN_PROTOCOL,
    keyID: LOGIN_KEY_ID,
    counterparty: "anyone",
  });
  return submit({ kind: "brc100", message, identityKey, identitySig: Utils.toHex(idSig), keys: [] });
}

async function post(url: string, body: object) {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

/**
 * Prove you hold this room's asset: find its outputs in the wallet, then sign one challenge with the key that locks
 * them (one wallet approval). The server checks the outputs on-chain and remembers them for later visits.
 */
export async function proveRoom(kind: string, id: string, onStatus: (s: string) => void = () => {}) {
  const conn = await connectBrc100().catch(() => null);
  if (!conn) throw new NoWalletError("No wallet found");
  onStatus("Looking in your wallet…");
  const items = (await assetOutputs(conn.wallet)).slice(-MAX_PROOF_OUTPUTS * 5);
  const api = `/api/rooms/${kind}/${encodeURIComponent(id)}/prove`;

  // Which of the wallet's outputs are this room's asset (the server checks the chain, in batches).
  const matching = new Set<string>();
  for (let i = 0; i < items.length && matching.size === 0; i += MAX_PROOF_OUTPUTS) {
    const batch = items.slice(i, i + MAX_PROOF_OUTPUTS).map((o) => o.outpoint);
    const { outpoints } = (await post(api, { outputs: batch })) as { outpoints: string[] };
    outpoints.forEach((o) => matching.add(o.replace("_", ".")));
  }
  const norm = (o: string) => o.replace("_", ".");
  const held = items.filter((o) => matching.has(norm(o.outpoint)));
  if (!held.length) throw new Error("Your wallet doesn't hold this yet.");
  const d = held.find((o) => o.derivation)?.derivation;
  if (!d) throw new Error("Your wallet didn't say which key holds this, so it can't be proved yet. Yours Wallet works today.");

  // Every output locked to that same key is proved by the one signature.
  const sameKey = held.filter((o) => JSON.stringify(o.derivation) === JSON.stringify(d)).map((o) => o.outpoint);
  const message = await getChallenge();
  onStatus("Approve in Yours to prove you hold it…");
  const { publicKey } = await conn.wallet.getPublicKey({ ...d, forSelf: true });
  const { signature } = await conn.wallet.createSignature({ ...d, data: Utils.toArray(message, "utf8") });
  onStatus("Checking on-chain…");
  return post(api, { outputs: sameKey, message, pubKey: publicKey, sig: Utils.toHex(signature) });
}

async function loginLegacy(yours: YoursProviderType, onStatus: (s: string) => void) {
  onStatus("Connecting to Yours…");
  await yours.connect();
  const message = await getChallenge();
  onStatus("Approve the sign-in in Yours…");
  // Sign with the ordinals key: that's the address holding the user's ordinals and tokens.
  const signed = await yours.signMessage({ message, tag: { label: "yours", id: "ord", domain: "", meta: {} } });
  if (!signed) throw new Error("Signature was rejected");
  const profile = await yours.getSocialProfile().catch(() => undefined);
  return submit({
    kind: "legacy",
    message,
    sig: signed.sig,
    pubKey: signed.pubKey,
    address: signed.address,
    name: profile?.displayName,
  });
}

export class NoWalletError extends Error {}

/** Sign in with Yours: BRC-100 (Yours v5+) first, then the legacy injected provider. */
export async function signIn(onStatus: (s: string) => void = () => {}) {
  onStatus("Looking for Yours Wallet…");
  const result = await connectBrc100().catch(() => null);
  if (result) return loginBrc100(result.wallet, result.identityKey, onStatus);
  if (window.yours?.isReady) return loginLegacy(window.yours, onStatus);
  throw new NoWalletError("No wallet found");
}

export async function signOut() {
  await fetch("/api/auth/logout", { method: "POST" });
}

/**
 * Spendable wallet balance in sats, or null if the wallet won't say.
 * Yours v5 (BRC-100) has no balance call, so this sums the default basket; wallets may refuse that.
 */
export async function walletBalance(): Promise<number | null> {
  const conn = await connectBrc100().catch(() => null);
  if (conn) {
    try {
      let total = 0;
      for (let offset = 0; offset < 20_000; offset += 1000) {
        const { outputs } = await conn.wallet.listOutputs({ basket: "default", limit: 1000, offset });
        total += outputs.filter((o) => o.spendable).reduce((sum, o) => sum + o.satoshis, 0);
        if (outputs.length < 1000) break;
      }
      return total;
    } catch (e) {
      log("wallet would not share its balance", e);
      return null;
    }
  }
  if (window.yours?.isReady) {
    const b = await window.yours.getBalance().catch(() => undefined);
    return b?.satoshis ?? null;
  }
  return null;
}
