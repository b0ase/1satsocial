// Server-side holdings verification against the GorillaPool 1Sat indexer.
// Never trust the client about what it holds; always ask the chain.

import { artUrl } from "./content";

const GP = process.env.ORDINALS_API_URL || "https://ordinals.gorillapool.io/api";

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

async function gp<T>(path: string): Promise<T> {
  const res = await fetch(`${GP}${path}`, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(30_000),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Indexer ${res.status} for ${path}`);
  return res.json() as Promise<T>;
}

type BalanceRow = {
  id?: string;
  tick?: string;
  sym?: string;
  dec: number;
  icon?: string;
  all: { confirmed: string; pending: string };
};

export type FungibleHolding = {
  kind: "bsv21" | "bsv20";
  key: string; // id for bsv21, upper-cased tick for bsv20
  symbol: string;
  dec: number;
  icon: string | null;
  amount: bigint; // raw units
};

/** Fungible (BSV-20 + BSV-21) balances for one address. Cached 60s. */
export function fungibleBalances(address: string): Promise<FungibleHolding[]> {
  return cached(`bal:${address}`, 60_000, async () => {
    const rows = await gp<BalanceRow[]>(`/bsv20/${encodeURIComponent(address)}/balance`);
    return rows
      .map((r): FungibleHolding => {
        const amount = BigInt(r.all.confirmed || "0") + BigInt(r.all.pending || "0");
        return r.id
          ? { kind: "bsv21", key: r.id, symbol: r.sym || r.id.slice(0, 8), dec: r.dec, icon: r.icon ?? null, amount }
          : { kind: "bsv20", key: (r.tick || "").toUpperCase(), symbol: r.tick || "?", dec: r.dec, icon: null, amount };
      })
      .filter((h) => h.amount > BigInt(0) && h.key);
  });
}

type Txo = {
  outpoint: string;
  origin?: { outpoint: string; data?: { map?: { subType?: string; subTypeData?: { collectionId?: string } } } };
};

function q(obj: object) {
  return encodeURIComponent(Buffer.from(JSON.stringify(obj)).toString("base64"));
}

/** Number of items from a collection held by an address (capped at 100). Cached 60s. */
export function collectionCount(address: string, collectionId: string): Promise<number> {
  return cached(`coll:${address}:${collectionId}`, 60_000, async () => {
    const filter = q({ map: { subTypeData: { collectionId } } });
    const txos = await gp<Txo[]>(`/txos/address/${encodeURIComponent(address)}/unspent?limit=100&q=${filter}`);
    return txos.length;
  });
}

/** All collections an address holds items from, with counts. Cached 2 min. */
export function heldCollections(address: string): Promise<Map<string, number>> {
  return cached(`colls:${address}`, 120_000, async () => {
    const counts = new Map<string, number>();
    const filter = q({ map: { subType: "collectionItem" } });
    const pageSize = 300;
    for (let offset = 0; offset < 1500; offset += pageSize) {
      const page = await gp<Txo[]>(
        `/txos/address/${encodeURIComponent(address)}/unspent?limit=${pageSize}&offset=${offset}&q=${filter}`,
      );
      for (const t of page) {
        const id = t.origin?.data?.map?.subTypeData?.collectionId;
        if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
      }
      if (page.length < pageSize) break;
    }
    return counts;
  });
}

export type RoomMeta = {
  title: string;
  subtitle: string;
  image: string | null;
  holders: number | null;
  dec: number;
};

type TokenInfo = { sym?: string; tick?: string; icon?: string; dec?: number; accounts?: number; max?: string; amt?: string };
type Inscription = {
  origin?: { data?: { map?: { name?: string; subTypeData?: { description?: string } }; insc?: { file?: { type?: string } } } };
};

export function roomMeta(kind: string, id: string): Promise<RoomMeta | null> {
  return cached(`meta:${kind}:${id}`, 10 * 60_000, async () => {
    try {
      if (kind === "bsv21") {
        const t = await gp<TokenInfo>(`/bsv20/id/${id}`);
        return {
          title: `$${(t.sym ?? id.slice(0, 8)).replace(/^\$/, "")}`,
          subtitle: "BSV-21 token",
          image: artUrl(t.icon),
          holders: t.accounts ?? null,
          dec: t.dec ?? 0,
        };
      }
      if (kind === "bsv20") {
        const t = await gp<TokenInfo>(`/bsv20/tick/${encodeURIComponent(id)}`);
        return { title: `$${(t.tick ?? id).replace(/^\$/, "")}`, subtitle: "BSV-20 token", image: null, holders: t.accounts ?? null, dec: t.dec ?? 0 };
      }
      if (kind === "coll") {
        const i = await gp<Inscription>(`/inscriptions/${id}`);
        const map = i.origin?.data?.map;
        const isImage = i.origin?.data?.insc?.file?.type?.startsWith("image/");
        return {
          title: map?.name || `Collection ${id.slice(0, 8)}`,
          subtitle: map?.subTypeData?.description?.slice(0, 140) || "1Sat Ordinals collection",
          image: isImage ? artUrl(id) : null,
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

export type Trending = { kind: "bsv21" | "bsv20" | "coll"; id: string; trades: number };

type TokenSale = { id?: string; tick?: string };
type OrdSale = { origin?: { data?: { map?: { subTypeData?: { collectionId?: string } | string } } } };

/** Most-traded tokens and collections across recent 1sat.market sales. Cached 10 min. */
export function trending(limit = 9): Promise<{ tokens: Trending[]; collections: Trending[] }> {
  return cached(`trending:${limit}`, 2 * 60_000, async () => {
    const pages = [0, 200];
    const [tokenPages, ordPages] = await Promise.all([
      Promise.all(pages.map((o) => gp<TokenSale[]>(`/bsv20/market/sales?limit=200&offset=${o}&dir=desc`).catch(() => []))),
      Promise.all(pages.map((o) => gp<OrdSale[]>(`/market/sales?limit=200&offset=${o}&dir=desc`).catch(() => []))),
    ]);

    const tokenCounts = new Map<string, Trending>();
    for (const s of tokenPages.flat()) {
      const t: Omit<Trending, "trades"> | null = s.id
        ? { kind: "bsv21", id: s.id }
        : s.tick
          ? { kind: "bsv20", id: s.tick.toUpperCase() }
          : null;
      if (!t) continue;
      const k = `${t.kind}:${t.id}`;
      tokenCounts.set(k, { ...t, trades: (tokenCounts.get(k)?.trades ?? 0) + 1 });
    }

    const collCounts = new Map<string, Trending>();
    for (const s of ordPages.flat()) {
      const std = s.origin?.data?.map?.subTypeData;
      const id = typeof std === "object" ? std?.collectionId : undefined;
      if (!id) continue;
      collCounts.set(id, { kind: "coll", id, trades: (collCounts.get(id)?.trades ?? 0) + 1 });
    }

    const top = (m: Map<string, Trending>) => [...m.values()].sort((a, b) => b.trades - a.trades).slice(0, limit);
    return { tokens: top(tokenCounts), collections: top(collCounts) };
  });
}
