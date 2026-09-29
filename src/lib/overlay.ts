// 1Sat overlay indexing status for BSV-21 tokens, and GorillaPool-based listing checks for
// listings the overlay never saw (the overlay only indexes transactions submitted to it).

const GP = process.env.ORDINALS_API_URL || "https://ordinals.gorillapool.io/api";
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
      const s = ((await res.json()) as OverlayToken).status;
      // Only trust a fee address that GorillaPool also reports as this token's fund address.
      const gp = await fetch(`${GP}/bsv20/id/${tokenId}`, { signal: AbortSignal.timeout(15_000), cache: "no-store" })
        .then((r) => (r.ok ? (r.json() as Promise<{ fundAddress?: string }>) : null))
        .catch(() => null);
      if (s?.fee_address && gp?.fundAddress === s.fee_address) {
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

type GpOutput = { id?: string; status?: number; listing?: boolean; spend?: string; amt?: string; price?: string };

/**
 * Is this outpoint a live, valid listing of the token according to GorillaPool?
 * Used in place of the overlay check for listings the overlay never indexed.
 */
export async function verifyListing(tokenId: string, outpoint: string): Promise<{ ok: boolean; reason?: string }> {
  const op = outpoint.replace(".", "_");
  if (!/^[0-9a-f]{64}_\d+$/.test(op)) return { ok: false, reason: "bad-outpoint" };
  try {
    const res = await fetch(`${GP}/bsv20/outpoint/${op}`, { signal: AbortSignal.timeout(15_000), cache: "no-store" });
    if (!res.ok) return { ok: false, reason: "not-indexed" };
    const d = (await res.json()) as GpOutput;
    if (d.id !== tokenId) return { ok: false, reason: "wrong-token" };
    if (d.status !== 1) return { ok: false, reason: "invalid-token-output" };
    if (!d.listing) return { ok: false, reason: "not-a-listing" };
    if (d.spend) return { ok: false, reason: "already-sold" };
    return { ok: true };
  } catch {
    return { ok: false, reason: "indexer-unreachable" };
  }
}
