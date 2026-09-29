// Marketplace activity from 1sat-stack.
//  - Live listings: TXO search on the "ordlock" key (every unspent OrdLock listing, newest first). Items are mapped
//    to their collection via their origin (ORDFS metadata, cached: immutable).
//  - Sales: the market API (/market/listings?status=sale). Its history is still being backfilled; the shape is stable.
//  - BSV-21: the overlay's active-token list; per-token listings come from the token overlay (see market.ts).
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
  origin: string | null; // item origin (collections), for its art
  height: number | null;
};

export async function search(params: Record<string, string | string[]>): Promise<SearchRow[]> {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) for (const x of [v].flat()) q.append(k, x);
  const res = await fetch(`${ONESAT}/txo/search?${q}`, { signal: AbortSignal.timeout(45_000), cache: "no-store" });
  if (!res.ok) throw new Error(`1sat-stack search ${res.status}`);
  return ((await res.json()) as SearchRow[] | null) ?? [];
}

type OrdfsMeta = { origin?: string; contentType?: string; map?: { name?: string; subType?: string; subTypeData?: string | { collectionId?: string } } };
type ItemInfo = { id: string; name: string | null; origin: string; image: boolean };

const g = globalThis as unknown as {
  __ssItemColl?: Map<string, ItemInfo | null>;
  __ssRecent?: Map<string, { value: RecentListing[]; expires: number }>;
};
const itemColl = (g.__ssItemColl ??= new Map());

/** Collection (and item name) of the inscription at this outpoint, from its origin. */
export async function itemCollection(outpoint: string): Promise<ItemInfo | null> {
  if (itemColl.has(outpoint)) return itemColl.get(outpoint)!;
  let value: ItemInfo | null = null;
  try {
    const res = await fetch(`${ONESAT}/ordfs/metadata/${outpoint.replace("_", ".")}:-2`, { signal: AbortSignal.timeout(10_000), cache: "no-store" });
    if (res.ok) {
      const meta = (await res.json()) as OrdfsMeta;
      const m = meta.map;
      let std = m?.subTypeData;
      if (typeof std === "string") std = JSON.parse(std) as { collectionId?: string };
      if (m?.subType === "collectionItem" && std?.collectionId) {
        value = {
          id: std.collectionId,
          name: m.name ?? null,
          origin: (meta.origin ?? outpoint).replace(".", "_"),
          image: !!meta.contentType?.startsWith("image/"),
        };
      }
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

// Scores are block heights (with a fractional index) once mined, or unix times while unconfirmed.
const heightOf = (score?: number) => (score && score < 1e8 ? Math.floor(score) : null);

async function liveListings(): Promise<RecentListing[]> {
  const rows = await search({ key: "ordlock", rev: "true", unspent: "true", limit: "300", tags: "bsv21,ordlock" });
  const mapped = await mapLimit(rows, 8, async (r): Promise<RecentListing | null> => {
    const outpoint = r.outpoint.replace(".", "_");
    const priceSats = r.data?.ordlock?.price ?? 0;
    if (!priceSats) return null;
    const token = r.data?.bsv21;
    if (token?.id && token.amt) {
      const ref = parseRoom("bsv21", token.id);
      return ref ? { event: "listed", outpoint, kind: "bsv21", id: ref.id, priceSats, amount: token.amt, name: null, origin: null, height: heightOf(r.score) } : null;
    }
    const item = await itemCollection(outpoint);
    const ref = item ? parseRoom("coll", item.id) : null;
    return ref && item
      ? { event: "listed", outpoint, kind: "coll", id: ref.id, priceSats, amount: null, name: item.name, origin: item.image ? item.origin : null, height: heightOf(r.score) }
      : null;
  });
  return mapped.filter((l): l is RecentListing => !!l);
}

async function sales(): Promise<RecentListing[]> {
  const res = await fetch(`${ONESAT}/market/listings?status=sale&limit=100`, { signal: AbortSignal.timeout(20_000), cache: "no-store" });
  if (!res.ok) throw new Error(`1sat-stack market ${res.status}`);
  const rows = ((await res.json()) as MarketRow[] | null) ?? [];
  const mapped = await mapLimit(rows, 8, async (r): Promise<RecentListing | null> => {
    const lock = r.data?.ordlock;
    const origin = lock?.origin?.replace(".", "_");
    if (!lock?.price || !origin) return null;
    const item = await itemCollection(origin);
    const ref = item ? parseRoom("coll", item.id) : null;
    return ref && item
      ? { event: "sold", outpoint: r.outpoint.replace(".", "_"), kind: "coll", id: ref.id, priceSats: lock.price, amount: null, name: lock.name ?? item.name, origin: item.image ? item.origin : null, height: heightOf(lock.spend_score) }
      : null;
  });
  return mapped.filter((l): l is RecentListing => !!l);
}

/** Newest live listings ("active") or sales ("sale"). Cached 60s. */
export async function recentListings(status: "active" | "sale" = "active"): Promise<RecentListing[]> {
  const hit = recentCache.get(status);
  if (hit && hit.expires > Date.now()) return hit.value;
  const value = status === "active" ? await liveListings() : await sales();
  recentCache.set(status, { value, expires: Date.now() + 60_000 });
  return value;
}

type OverlayToken = { token_id?: string; output_count?: number; is_active?: boolean; is_blacklisted?: boolean };

/** The most-used active BSV-21 tokens in the 1Sat overlay (by indexed outputs). Cached 10 min. */
export async function activeTokens(limit = 30): Promise<string[]> {
  const hit = tokenCache.value;
  if (hit && hit.expires > Date.now()) return hit.value.slice(0, limit);
  const res = await fetch(`${ONESAT}/bsv21/tokens`, { signal: AbortSignal.timeout(20_000), cache: "no-store" });
  if (!res.ok) throw new Error(`1sat-stack tokens ${res.status}`);
  const rows = ((await res.json()) as OverlayToken[] | null) ?? [];
  const value = rows
    .filter((t) => t.token_id && t.is_active && !t.is_blacklisted)
    .sort((a, b) => (b.output_count ?? 0) - (a.output_count ?? 0))
    .map((t) => t.token_id!)
    .filter((id) => !!parseRoom("bsv21", id));
  tokenCache.value = { value, expires: Date.now() + 10 * 60_000 };
  return value.slice(0, limit);
}
const tokenCache: { value?: { value: string[]; expires: number } } = {};

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
