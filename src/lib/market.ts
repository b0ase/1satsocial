// Marketplace data for rooms: cheapest live listings (buyable in-app) and floor prices.
import { formatAmount, roomMeta } from "./indexer";
import { artUrl } from "./content";
import { recentListings, search } from "./listings";
import type { RoomRef } from "./room-ref";

export type Listing = {
  outpoint: string;
  priceSats: number;
  /** Raw token amount (BSV-21 only), as a string for JSON. */
  amount: string | null;
  label: string; // "5,000 $DOTI" or "Pixel Foxes #12"
  image: string | null;
  seller: string;
  /** Can be bought in-app with the 1Sat SDK. */
  buyable: boolean;
  /** Legacy: listings unknown to the 1Sat overlay (no longer produced; every listing now comes from the overlay). */
  chatOnly: boolean;
  /** Identical lots (same amount, price, buyability) collapsed into this row. */
  count: number;
};

/** Collapse identical lots so the list shows distinct options ("×3"). */
function collapse(listings: Listing[]): Listing[] {
  const out: Listing[] = [];
  for (const l of listings) {
    const same = out.find((o) => o.label === l.label && o.priceSats === l.priceSats && o.buyable === l.buyable && o.chatOnly === l.chatOnly);
    if (same) same.count++;
    else out.push({ ...l, count: 1 });
  }
  return out;
}

export type RoomMarket = {
  listings: Listing[];
  floorLabel: string | null;
  /** Floor in sats: per whole token for fungible rooms, per item for collections. */
  floorSats: number | null;
  /** Live listings found (before collapsing/limiting), and how many of them can be bought in-app. */
  live: number;
  buyableCount: number;
};

const g = globalThis as unknown as { __ssMarket?: Map<string, { value: RoomMarket; expires: number }> };
const cache = (g.__ssMarket ??= new Map());

export function formatSats(sats: number): string {
  if (sats >= 1e8) return `${(sats / 1e8).toLocaleString("en-US", { maximumFractionDigits: 4 })} BSV`;
  return `${sats.toLocaleString("en-US")} sats`;
}

function formatPerToken(sats: number): string {
  if (sats >= 1) return formatSats(Math.round(sats));
  return `${sats.toPrecision(2).replace(/\.?0+$/, "")} sats`;
}

const ONESAT = process.env.ONESAT_API_URL || "https://api.1sat.app/1sat";

/** Which BSV-21 listing outpoints the 1Sat overlay recognises (what buyBsv21 validates against). */
async function overlayValid(tokenId: string, outpoints: string[]): Promise<Set<string>> {
  if (!outpoints.length) return new Set();
  try {
    const res = await fetch(`${ONESAT}/bsv21/${tokenId}/outputs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(outpoints),
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });
    const rows = res.ok ? ((await res.json()) as { outpoint: string }[] | null) : null;
    return new Set((rows ?? []).map((r) => r.outpoint.replace(".", "_")));
  } catch {
    return new Set();
  }
}

/** Live BSV-21 listings of a token, from 1sat-stack (token outputs intersected with OrdLock listings). */
async function loadMarket(room: RoomRef, limit: number): Promise<RoomMarket> {
  if (room.kind === "coll") {
    // 1sat-stack can't search listings by collection yet, so use the collection's items among the newest live
    // listings market-wide. Recent listings only, so the floor is "cheapest recent listing".
    const meta = await roomMeta(room.kind, room.id);
    const listings = (await recentListings("active"))
      .filter((l) => l.kind === "coll" && l.id === room.id)
      .map((l): Listing => ({
        outpoint: l.outpoint,
        priceSats: l.priceSats,
        amount: null,
        label: l.name ?? meta?.title ?? "Item",
        image: artUrl(l.origin),
        seller: "",
        buyable: true,
        chatOnly: false,
        count: 1,
      }))
      .sort((a, b) => a.priceSats - b.priceSats);
    return {
      listings: listings.slice(0, limit),
      floorLabel: listings[0] ? formatSats(listings[0].priceSats) : null,
      floorSats: listings[0]?.priceSats ?? null,
      live: listings.length,
      buyableCount: listings.length,
    };
  }
  if (room.kind !== "bsv21") return { listings: [], floorLabel: null, floorSats: null, live: 0, buyableCount: 0 }; // BSV-20: retired
  const [rows, meta] = await Promise.all([
    search({ key: [`bsv21:${room.id}`, "ordlock"], join: "intersect", unspent: "true", rev: "true", limit: "100", tags: "bsv21,ordlock" }),
    roomMeta(room.kind, room.id),
  ]);
  const valid = await overlayValid(room.id, rows.map((r) => r.outpoint));
  const dec = meta?.dec ?? 0;
  const sym = (meta?.title ?? "").replace(/^\$/, "");
  const listings = rows
    .filter((r) => r.data?.bsv21?.id === room.id && (r.data.ordlock?.price ?? 0) > 0 && BigInt(r.data.bsv21.amt ?? "0") > BigInt(0))
    .map((r): Listing => ({
      outpoint: r.outpoint.replace(".", "_"),
      priceSats: r.data!.ordlock!.price!,
      amount: r.data!.bsv21!.amt!,
      label: `${formatAmount(BigInt(r.data!.bsv21!.amt!), dec)} $${sym}`,
      image: null,
      seller: r.data!.ordlock!.seller?.AddressString ?? "",
      // In-app purchase needs the listing in the overlay topic (buyBsv21 validates against it).
      buyable: valid.has(r.outpoint.replace(".", "_")),
      chatOnly: false,
      count: 1,
    }))
    .sort((a, b) => a.priceSats - b.priceSats);
  const perToken = (l: Listing) => l.priceSats / (Number(l.amount) / 10 ** dec);
  const floor = listings.length ? Math.min(...listings.map(perToken)) : null;
  // Cheapest first, but always include the cheapest few that can be bought in-app.
  const distinct = collapse(listings);
  const picked = distinct.slice(0, limit);
  for (const l of distinct.filter((x) => x.buyable).slice(0, 3)) if (!picked.includes(l)) picked.push(l);
  return {
    listings: picked,
    floorLabel: floor === null ? null : `${formatPerToken(floor)} / token`,
    floorSats: floor,
    live: listings.length,
    buyableCount: listings.filter((l) => l.buyable).length,
  };
}

/** Cheapest listings for a room. Cached 60s. */
export async function roomMarket(room: RoomRef, limit = 8): Promise<RoomMarket> {
  const key = `${room.key}:${limit}`;
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;
  const value = await loadMarket(room, limit).catch((): RoomMarket => ({ listings: [], floorLabel: null, floorSats: null, live: 0, buyableCount: 0 }));
  cache.set(key, { value, expires: Date.now() + 60_000 });
  return value;
}

export function marketUrl(room: RoomRef) {
  if (room.kind === "coll") return `https://1sat.market/collection/${room.id}`;
  return "https://1sat.market";
}
