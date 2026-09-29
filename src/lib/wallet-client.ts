"use client";

import { connectWallet } from "@1sat/connect";
import { Utils, type WalletInterface, type WalletProtocol } from "@bsv/sdk";
import type { YoursProviderType } from "yours-wallet-provider";
import { LOGIN_KEY_ID, LOGIN_PROTOCOL, MAX_PROOF_KEYS, type LoginProof } from "./login-shared";

declare global {
  interface Window {
    yours?: YoursProviderType;
  }
}

// Wallet baskets that hold 1Sat assets (see @1sat/types: ONESAT_BASKET, BSV21_BASKET, BSV20_BASKET).
const ASSET_BASKETS = ["1sat", "bsv21", "bsv20"];

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
  return data as { userId: string; addresses: string[] };
}

// P1SAT deposit addresses (see deriveDepositAddresses in @1sat/actions): where received
// ordinals and tokens land by default. Current and pre-rename protocol, first few indexes.
const DEPOSIT_DERIVATIONS: Derivation[] = [[0, "onesat"], [0, "p 1sat"]].flatMap((protocolID) =>
  [0, 1, 2].map((i) => ({ protocolID: protocolID as WalletProtocol, keyID: `1sat ${i}`, counterparty: "self" })),
);

const log = (...args: unknown[]) => console.info("[1satsocial]", ...args);

// Sign-in diagnostics, sent to the server (kept in memory, dev only) to debug wallet formats.
const diag: Record<string, unknown> = {};

/** Collect the distinct keys that lock this wallet's ordinals and tokens. */
async function assetDerivations(wallet: WalletInterface): Promise<Derivation[]> {
  const seen = new Map<string, Derivation>();
  for (const basket of ASSET_BASKETS) {
    for (let offset = 0; offset < 5000 && seen.size < MAX_PROOF_KEYS; offset += 500) {
      let res;
      try {
        res = await wallet.listOutputs({
          basket,
          include: "locking scripts",
          includeCustomInstructions: true,
          includeTags: true,
          limit: 500,
          offset,
        });
      } catch (e) {
        log(`listOutputs(${basket}) failed`, e);
        diag[`basket:${basket}:error`] = String(e);
        break;
      }
      const { outputs, totalOutputs } = res;
      let parsed = 0;
      for (const o of outputs) {
        const ci = await plaintextCi(wallet, o.customInstructions);
        if (!ci) continue;
        try {
          const d = JSON.parse(ci) as Partial<Derivation>;
          if (!d.protocolID || !d.keyID) continue;
          const deriv = { protocolID: d.protocolID, keyID: d.keyID, counterparty: d.counterparty ?? "self" };
          seen.set(JSON.stringify(deriv), deriv);
          parsed++;
        } catch {
          /* not a derivation record */
        }
      }
      // Diagnostics: the shape of what the wallet returns is not yet documented for this use.
      diag[`basket:${basket}:${offset}`] = {
        totalOutputs,
        returned: outputs.length,
        withDerivation: parsed,
        samples: outputs.slice(0, 3).map((o) => ({
          outpoint: o.outpoint,
          satoshis: o.satoshis,
          lockingScript: o.lockingScript?.slice(0, 80),
          customInstructions: o.customInstructions?.slice(0, 200),
          tags: o.tags?.slice(0, 8),
        })),
      };
      log(`basket "${basket}"`, diag[`basket:${basket}:${offset}`]);
      if (outputs.length < 500) break;
    }
  }
  for (const d of DEPOSIT_DERIVATIONS) seen.set(JSON.stringify(d), d);
  return [...seen.values()].slice(0, MAX_PROOF_KEYS);
}

async function loginBrc100(wallet: WalletInterface, identityKey: string, onStatus: (s: string) => void) {
  onStatus("Finding your ordinals and tokens…");
  const derivations = await assetDerivations(wallet);
  const message = await getChallenge();
  const data = Utils.toArray(message, "utf8");

  onStatus("Approve the sign-in in Yours…");
  const { signature: idSig } = await wallet.createSignature({
    data,
    protocolID: LOGIN_PROTOCOL,
    keyID: LOGIN_KEY_ID,
    counterparty: "anyone",
  });

  const keys: { pubKey: string; sig: string }[] = [];
  for (const [i, d] of derivations.entries()) {
    onStatus(`Proving holdings (${i + 1}/${derivations.length})…`);
    try {
      const { publicKey } = await wallet.getPublicKey({ ...d, forSelf: true });
      const { signature } = await wallet.createSignature({ ...d, data });
      keys.push({ pubKey: publicKey, sig: Utils.toHex(signature) });
    } catch (e) {
      log("could not sign with", d, e);
      diag[`sign-error:${d.protocolID[1]}:${d.keyID}`] = String(e);
    }
  }

  diag.derivations = derivations;
  const result = await submit({ kind: "brc100", message, identityKey, identitySig: Utils.toHex(idSig), keys, diag });
  log("verified addresses", result.addresses);
  return result;
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
  const result = await connectWallet().catch(() => null);
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
  const conn = await connectWallet().catch(() => null);
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
