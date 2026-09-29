// Room metadata and address balances from 1sat-stack (the 1Sat overlay and ORDFS).

import { artUrl } from "./content";

const ONESAT = process.env.ONESAT_API_URL || "https://api.1sat.app/1sat";

async function onesat<T>(path: string): Promise<T> {
  const res = await fetch(`${ONESAT}${path}`, { signal: AbortSignal.timeout(15_000), cache: "no-store" });
  if (!res.ok) throw new Error(`1sat-stack ${res.status} for ${path}`);
  return res.json() as Promise<T>;
}

type CacheEntry<T> = { value: T; expires: number };
const g = globalThis as unknown as { __ssCache?: Map<string, CacheEntry<unknown>> };
const cache = (g.__ssCache ??= new Map());

async function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key) as CacheEntry<T> | undefined;
  if (hit && hit.expires > Date.now()) return hit.value;
  const value = await fn();
  cache.set(key, { value, expires: Date.now() + ttlMs });
  return value;
}

/** BSV-21 balance (raw units) across addresses, from the overlay. Cached 60s. */
export function bsv21Balance(tokenId: string, addresses: string[]): Promise<bigint> {
  if (!addresses.length) return Promise.resolve(BigInt(0));
  return cached(`bal:${tokenId}:${[...addresses].sort().join(",")}`, 60_000, async () => {
    const res = await fetch(`${ONESAT}/bsv21/${tokenId}/p2pkh/balance`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(addresses.slice(0, 100)),
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`1sat-stack ${res.status} for balance`);
    return BigInt(((await res.json()) as { balance?: number | string }).balance ?? 0);
  });
}

export type RoomMeta = {
  title: string;
  subtitle: string;
  image: string | null;
  holders: number | null;
  dec: number;
};

type Bsv21Token = { token?: { sym?: string; icon?: string; dec?: string | number } };
type OrdfsMetadata = { contentType?: string; map?: { name?: string; subTypeData?: string | { description?: string } } };

function description(std: string | { description?: string } | undefined) {
  if (typeof std === "object") return std?.description;
  try {
    return (JSON.parse(std ?? "") as { description?: string }).description;
  } catch {
    return undefined;
  }
}

export function roomMeta(kind: string, id: string): Promise<RoomMeta | null> {
  return cached(`meta:${kind}:${id}`, 10 * 60_000, async () => {
    try {
      // BSV-21 and collections come from 1sat-stack (overlay token record, ORDFS metadata). Holder counts aren't
      // served there, so they're left out rather than fetched from another indexer.
      if (kind === "bsv21") {
        const { token: t } = await onesat<Bsv21Token>(`/bsv21/${id}`);
        return {
          title: `$${(t?.sym ?? id.slice(0, 8)).replace(/^\$/, "")}`,
          subtitle: "BSV-21 token",
          image: artUrl(t?.icon),
          holders: null,
          dec: Number(t?.dec ?? 0) || 0,
        };
      }
      if (kind === "coll") {
        const m = await onesat<OrdfsMetadata>(`/ordfs/metadata/${id.replace("_", ".")}`);
        return {
          title: m.map?.name || `Collection ${id.slice(0, 8)}`,
          subtitle: description(m.map?.subTypeData)?.slice(0, 140) || "1Sat Ordinals collection",
          image: m.contentType?.startsWith("image/") ? artUrl(id) : null,
          holders: null,
          dec: 0,
        };
      }
    } catch {
      /* unknown token or indexer error */
    }
    return null;
  });
}

export function formatAmount(amount: bigint, dec: number): string {
  if (dec <= 0) return amount.toLocaleString("en-US");
  const base = BigInt(10) ** BigInt(dec);
  const whole = amount / base;
  const frac = (amount % base).toString().padStart(dec, "0").slice(0, 2).replace(/0+$/, "");
  return whole.toLocaleString("en-US") + (frac ? `.${frac}` : "");
}
