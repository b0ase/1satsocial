// Marketplace data for rooms: cheapest live listings (buyable in-app) and floor prices.
import { artUrl } from "./content";
import { formatAmount, roomMeta } from "./indexer";
import type { RoomRef } from "./room-ref";

const GP = process.env.ORDINALS_API_URL || "https://ordinals.gorillapool.io/api";
const ONESAT = process.env.ONESAT_API_URL || "https://api.1sat.app/1sat";

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
  /** Valid on GorillaPool but unknown to the 1Sat overlay: buyable for chat access only (see buy-client). */
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
};

const g = globalThis as unknown as { __ssMarket?: Map<string, { value: RoomMarket; expires: number }> };
const cache = (g.__ssMarket ??= new Map());

async function get<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(15_000), cache: "no-store" });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json() as Promise<T>;
}

export function formatSats(sats: number): string {
  if (sats >= 1e8) return `${(sats / 1e8).toLocaleString("en-US", { maximumFractionDigits: 4 })} BSV`;
  return `${sats.toLocaleString("en-US")} sats`;
}

function formatPerToken(sats: number): string {
  if (sats >= 1) return formatSats(Math.round(sats));
  return `${sats.toPrecision(2).replace(/\.?0+$/, "")} sats`;
}

type TokenListing = { outpoint: string; amt: string; price: string; pricePer: string; dec: number; sym?: string; tick?: string; owner: string };
type OrdListing = {
  outpoint: string;
  owner: string;
  data?: { list?: { price: number } };
  origin?: { outpoint: string; data?: { map?: { name?: string }; insc?: { file?: { type?: string } } } };
};

/** Which BSV-21 listing outpoints the 1Sat overlay recognises (what buyBsv21 validates against). */
async function overlayValid(tokenId: string, outpoints: string[]): Promise<Set<string>> {
  if (!outpoints.length) return new Set();
  const rows = await get<{ outpoint: string }[] | null>(`${ONESAT}/bsv21/${tokenId}/outputs`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(outpoints),
  }).catch(() => null);
  return new Set((rows ?? []).map((r) => r.outpoint.replace(".", "_")));
}

async function loadMarket(room: RoomRef, limit: number): Promise<RoomMarket> {
  if (room.kind === "bsv21" || room.kind === "bsv20") {
    const filter = room.kind === "bsv21" ? `id=${room.id}` : `tick=${encodeURIComponent(room.id)}`;
    // Cheapest total price = cheapest way into the room; the per-token floor is fetched separately.
    const [byPrice, byPerToken] = await Promise.all([
      get<TokenListing[]>(`${GP}/bsv20/market?${filter}&sort=price&dir=asc&limit=80`),
      get<TokenListing[]>(`${GP}/bsv20/market?${filter}&sort=price_per_token&dir=asc&limit=5`).catch(() => []),
    ]);
    const sane = (r: TokenListing, i: number, all: TokenListing[]) =>
      Number(r.price) > 0 && BigInt(r.amt) > BigInt(0) && all.findIndex((x) => x.outpoint === r.outpoint) === i;
    const rows = byPrice.filter(sane);
    // BSV-20 (tick) purchases aren't supported by the SDK; those link out to 1sat.market.
    const valid = room.kind === "bsv21" ? await overlayValid(room.id, rows.map((r) => r.outpoint)) : new Set<string>();
    const listings = rows.map((r): Listing => {
      const sym = (r.sym ?? r.tick ?? "").replace(/^\$/, "");
      return {
        outpoint: r.outpoint,
        priceSats: Number(r.price),
        amount: r.amt,
        label: `${formatAmount(BigInt(r.amt), r.dec)} $${sym}`,
        image: null,
        seller: r.owner,
        buyable: valid.has(r.outpoint),
        chatOnly: room.kind === "bsv21" && !valid.has(r.outpoint),
        count: 1,
      };
    });
    // Cheapest first, but always include the cheapest few that can be bought in-app.
    listings.sort((a, b) => a.priceSats - b.priceSats);
    const distinct = collapse(listings);
    const picked = distinct.slice(0, limit);
    for (const l of distinct.filter((x) => x.buyable).slice(0, 3)) if (!picked.includes(l)) picked.push(l);
    // The indexer's pricePer is rounded to whole sats; compute the real per-token price.
    const perToken = (r: TokenListing) => Number(r.price) / (Number(r.amt) / 10 ** r.dec);
    const floorRows = [...byPerToken.filter(sane), ...rows];
    const floor = floorRows.length ? Math.min(...floorRows.map(perToken)) : null;
    return {
      listings: picked,
      floorLabel: floor === null ? null : `${formatPerToken(floor)} / token`,
      floorSats: floor,
    };
  }

  const q = Buffer.from(JSON.stringify({ map: { subTypeData: { collectionId: room.id } } })).toString("base64");
  const rows = await get<OrdListing[]>(`${GP}/market?q=${encodeURIComponent(q)}&sort=price&dir=asc&limit=${limit}`);
  const meta = await roomMeta(room.kind, room.id);
  const listings = rows
    .filter((r) => (r.data?.list?.price ?? 0) > 0)
    .map(
      (r): Listing => ({
        outpoint: r.outpoint,
        priceSats: r.data!.list!.price,
        amount: null,
        label: r.origin?.data?.map?.name ?? meta?.title ?? "Item",
        image:
          r.origin?.outpoint && r.origin.data?.insc?.file?.type?.startsWith("image/")
            ? artUrl(r.origin.outpoint)
            : null,
        seller: r.owner,
        buyable: true,
        chatOnly: false,
        count: 1,
      }),
    )
    .sort((a, b) => a.priceSats - b.priceSats);
  return {
    listings,
    floorLabel: listings[0] ? formatSats(listings[0].priceSats) : null,
    floorSats: listings[0]?.priceSats ?? null,
  };
}

/** Cheapest listings for a room. Cached 60s. */
export async function roomMarket(room: RoomRef, limit = 8): Promise<RoomMarket> {
  const key = `${room.key}:${limit}`;
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;
  const value = await loadMarket(room, limit).catch((): RoomMarket => ({ listings: [], floorLabel: null, floorSats: null }));
  cache.set(key, { value, expires: Date.now() + 60_000 });
  return value;
}

export function marketUrl(room: RoomRef) {
  if (room.kind === "coll") return `https://1sat.market/collection/${room.id}`;
  return "https://1sat.market";
}
