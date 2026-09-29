// 1Sat overlay indexing status for BSV-21 tokens, and listing checks against the overlay.

const ONESAT = process.env.ONESAT_API_URL || "https://api.1sat.app/1sat";

export type Indexing = {
  active: boolean;
  balanceSats: number;
  feeAddress: string;
  feePerOutput: number;
  outputCount: number;
};

type OverlayToken = {
  status?: {
    is_active?: boolean;
    balance?: number;
    fee_address?: string;
    fee_per_output?: number;
    output_count?: number;
  };
};

const g = globalThis as unknown as { __ssIndexing?: Map<string, { value: Indexing | null; expires: number }> };
const cache = (g.__ssIndexing ??= new Map());

/** Overlay indexing fund for a BSV-21 token. Cached 60s. */
export async function tokenIndexing(tokenId: string): Promise<Indexing | null> {
  const hit = cache.get(tokenId);
  if (hit && hit.expires > Date.now()) return hit.value;
  let value: Indexing | null = null;
  try {
    const res = await fetch(`${ONESAT}/bsv21/${tokenId}`, { signal: AbortSignal.timeout(15_000), cache: "no-store" });
    if (res.ok) {
      // The overlay is the service being funded, so its own record of the fee address is authoritative.
      const s = ((await res.json()) as OverlayToken).status;
      if (s?.fee_address) {
        value = {
          active: !!s.is_active,
          balanceSats: s.balance ?? 0,
          feeAddress: s.fee_address,
          feePerOutput: s.fee_per_output ?? 1000,
          outputCount: s.output_count ?? 0,
        };
      }
    }
  } catch {
    /* overlay unreachable */
  }
  cache.set(tokenId, { value, expires: Date.now() + 60_000 });
  return value;
}

type TxoRow = { spend?: string; data?: { bsv21?: { id?: string }; ordlock?: { price?: number } } };

/** Is this outpoint a live listing of the token in the 1Sat overlay (what buyBsv21 validates against)? */
export async function verifyListing(tokenId: string, outpoint: string): Promise<{ ok: boolean; reason?: string }> {
  const op = outpoint.replace("_", ".");
  if (!/^[0-9a-f]{64}\.\d+$/.test(op)) return { ok: false, reason: "bad-outpoint" };
  try {
    const [txo, overlay] = await Promise.all([
      fetch(`${ONESAT}/txo/${op}?tags=bsv21,ordlock&spend=true`, { signal: AbortSignal.timeout(15_000), cache: "no-store" }),
      fetch(`${ONESAT}/bsv21/${tokenId}/outputs/${op}`, { signal: AbortSignal.timeout(15_000), cache: "no-store" }),
    ]);
    if (!txo.ok) return { ok: false, reason: "not-indexed" };
    if (!overlay.ok) return { ok: false, reason: "not-in-overlay" };
    const d = (await txo.json()) as TxoRow;
    if (d.data?.bsv21?.id !== tokenId) return { ok: false, reason: "wrong-token" };
    if (!d.data.ordlock) return { ok: false, reason: "not-a-listing" };
    if (d.spend) return { ok: false, reason: "already-sold" };
    return { ok: true };
  } catch {
    return { ok: false, reason: "indexer-unreachable" };
  }
}
