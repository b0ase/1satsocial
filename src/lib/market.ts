// Marketplace data for rooms: cheapest live listings (buyable in-app) and floor prices.
import { CONTENT_URL, formatAmount, roomMeta } from "./indexer";
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
};

export type RoomMarket = { listings: Listing[]; floorLabel: string | null };

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
      };
    });
    // Buyable first, cheapest first within each group.
    listings.sort((a, b) => Number(b.buyable) - Number(a.buyable) || a.priceSats - b.priceSats);
    // The indexer's pricePer is rounded to whole sats; compute the real per-token price.
    const perToken = (r: TokenListing) => Number(r.price) / (Number(r.amt) / 10 ** r.dec);
    const floorRows = [...byPerToken.filter(sane), ...rows];
    const floor = floorRows.length ? Math.min(...floorRows.map(perToken)) : null;
    return {
      listings: listings.slice(0, limit),
      floorLabel: floor === null ? null : `${formatPerToken(floor)} / token`,
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
            ? `${CONTENT_URL}/${r.origin.outpoint}`
            : null,
        seller: r.owner,
        buyable: true,
      }),
    )
    .sort((a, b) => a.priceSats - b.priceSats);
  return { listings, floorLabel: listings[0] ? formatSats(listings[0].priceSats) : null };
}

/** Cheapest listings for a room. Cached 60s. */
export async function roomMarket(room: RoomRef, limit = 8): Promise<RoomMarket> {
  const key = `${room.key}:${limit}`;
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;
  const value = await loadMarket(room, limit).catch(() => ({ listings: [], floorLabel: null }));
  cache.set(key, { value, expires: Date.now() + 60_000 });
  return value;
}

export function marketUrl(room: RoomRef) {
  if (room.kind === "coll") return `https://1sat.market/collection/${room.id}`;
  return "https://1sat.market";
}
