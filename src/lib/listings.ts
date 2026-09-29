// Marketplace activity from 1sat-stack's market API (/market/listings: active listings and sales). Items are mapped
// to their collection via the listing's origin (ORDFS metadata, cached: immutable). The market index doesn't hold
// its full history yet (it's being backfilled), but its API shape is stable, so we build on it as-is.
// BSV-21 listings per token come from the token overlay instead (see market.ts).
import { parseRoom, type RoomKind } from "./room-ref";

const ONESAT = process.env.ONESAT_API_URL || "https://api.1sat.app/1sat";

export type SearchRow = {
  outpoint: string;
  score: number;
  data?: {
    bsv21?: { id?: string; amt?: string };
    ordlock?: { price?: number; seller?: { AddressString?: string } };
  };
};

export type RecentListing = {
  event: "listed" | "sold";
  outpoint: string; // txid_vout
  kind: RoomKind;
  id: string; // token id or collection id
  priceSats: number;
  amount: string | null; // raw token units (BSV-21)
  name: string | null; // item name (collections)
  height: number | null;
};

export async function search(params: Record<string, string | string[]>): Promise<SearchRow[]> {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) for (const x of [v].flat()) q.append(k, x);
  const res = await fetch(`${ONESAT}/txo/search?${q}`, { signal: AbortSignal.timeout(45_000), cache: "no-store" });
  if (!res.ok) throw new Error(`1sat-stack search ${res.status}`);
  return ((await res.json()) as SearchRow[] | null) ?? [];
}

type OrdfsMeta = { map?: { name?: string; subType?: string; subTypeData?: string | { collectionId?: string } } };

const g = globalThis as unknown as {
  __ssItemColl?: Map<string, { id: string; name: string | null } | null>;
  __ssRecent?: Map<string, { value: RecentListing[]; expires: number }>;
};
const itemColl = (g.__ssItemColl ??= new Map());

/** Collection (and item name) of the inscription at this outpoint, from its origin. */
async function itemCollection(outpoint: string): Promise<{ id: string; name: string | null } | null> {
  if (itemColl.has(outpoint)) return itemColl.get(outpoint)!;
  let value: { id: string; name: string | null } | null = null;
  try {
    const res = await fetch(`${ONESAT}/ordfs/metadata/${outpoint.replace("_", ".")}:-2`, { signal: AbortSignal.timeout(10_000), cache: "no-store" });
    if (res.ok) {
      const m = ((await res.json()) as OrdfsMeta).map;
      let std = m?.subTypeData;
      if (typeof std === "string") std = JSON.parse(std) as { collectionId?: string };
      if (m?.subType === "collectionItem" && std?.collectionId) value = { id: std.collectionId, name: m.name ?? null };
    } else if (res.status !== 404) {
      return null; // transient: don't cache
    }
  } catch {
    return null;
  }
  itemColl.set(outpoint, value);
  return value;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

type MarketRow = {
  outpoint: string;
  score: number;
  data?: { ordlock?: { name?: string; origin?: string; price?: number; spend_score?: number } };
};

const recentCache = (g.__ssRecent ??= new Map());

/** Newest listings ("active") or sales ("sale") on the market, mapped to collection rooms. Cached 60s. */
export async function recentListings(status: "active" | "sale" = "active"): Promise<RecentListing[]> {
  const hit = recentCache.get(status);
  if (hit && hit.expires > Date.now()) return hit.value;
  const res = await fetch(`${ONESAT}/market/listings?status=${status}&limit=100`, { signal: AbortSignal.timeout(20_000), cache: "no-store" });
  if (!res.ok) throw new Error(`1sat-stack market ${res.status}`);
  const rows = ((await res.json()) as MarketRow[] | null) ?? [];
  const mapped = await mapLimit(rows, 8, async (r): Promise<RecentListing | null> => {
    const lock = r.data?.ordlock;
    const origin = lock?.origin?.replace(".", "_");
    if (!lock?.price || !origin) return null;
    const coll = await itemCollection(origin);
    const ref = coll ? parseRoom("coll", coll.id) : null;
    if (!ref) return null;
    const when = status === "sale" ? lock.spend_score : r.score;
    // Scores are block heights (with a fractional index) once mined, or unix times while unconfirmed.
    const height = when && when < 1e8 ? Math.floor(when) : null;
    return { event: status === "sale" ? "sold" : "listed", outpoint: r.outpoint.replace(".", "_"), kind: "coll", id: ref.id, priceSats: lock.price, amount: null, name: lock.name ?? coll!.name, height };
  });
  const value = mapped.filter((l): l is RecentListing => !!l);
  recentCache.set(status, { value, expires: Date.now() + 60_000 });
  return value;
}

export type Activity = { kind: RoomKind; id: string; listings: number };

/** Rooms with the most new listings among the newest market listings. */
export async function listingActivity(limit = 12): Promise<{ tokens: Activity[]; collections: Activity[] }> {
  const counts = new Map<string, Activity>();
  const [listed, sold] = await Promise.all([recentListings("active").catch(() => []), recentListings("sale").catch(() => [])]);
  for (const l of [...listed, ...sold]) {
    const k = `${l.kind}:${l.id}`;
    counts.set(k, { kind: l.kind, id: l.id, listings: (counts.get(k)?.listings ?? 0) + 1 });
  }
  const all = [...counts.values()].sort((a, b) => b.listings - a.listings);
  return { tokens: all.filter((a) => a.kind === "bsv21").slice(0, limit), collections: all.filter((a) => a.kind === "coll").slice(0, limit) };
}
