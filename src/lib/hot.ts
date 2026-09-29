// The live "hot board" behind the landing page: which rooms are hottest right now, and a ticker of
// what's just been listed and sold. Built from real 1Sat marketplace data plus chat activity.
import { unstable_cache } from "next/cache";
import { formatAmount, roomMeta, trending } from "./indexer";
import { roomMarket } from "./market";
import { bsvUsd } from "./price";
import { parseRoom, roomFromKey, type RoomKind, type RoomRef } from "./room-ref";
import { store } from "./store";

const GP = process.env.ORDINALS_API_URL || "https://ordinals.gorillapool.io/api";
const ONESAT = process.env.ONESAT_API_URL || "https://api.1sat.app/1sat";

export type HotRoom = {
  kind: RoomKind;
  id: string;
  title: string;
  subtitle: string;
  image: string | null;
  holders: number | null;
  trades: number;
  newListings: number;
  chatMembers: number;
  chatMessages: number;
  floorSats: number | null;
  floorLabel: string | null;
  heat: number;
};

export type TickerItem = {
  key: string;
  event: "listed" | "sold";
  kind: RoomKind;
  id: string;
  label: string;
  sats: number;
  minutesAgo: number | null; // null = not yet in a block
};

export type HotBoard = { rooms: HotRoom[]; ticker: TickerItem[]; usdPerBsv: number | null; updatedAt: string };

type TokenRow = { outpoint: string; id?: string; tick?: string; sym?: string; amt: string; dec: number; price: string; height?: number | null };
type OrdRow = {
  outpoint: string;
  height?: number | null;
  data?: { list?: { price?: number } };
  origin?: { data?: { map?: { name?: string; subTypeData?: { collectionId?: string } | string } } };
};

const g = globalThis as unknown as {
  __ssHot?: { value: HotBoard; expires: number };
  __ssHotPending?: Promise<HotBoard>;
  __ssHotGood?: HotBoard; // last board with real data, used when an upstream call fails
};

/** A board missing its rooms or ticker means an upstream API failed; don't let that blank the page. */
function degraded(b: HotBoard) {
  return b.rooms.length === 0 || b.ticker.length === 0;
}

async function gp<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${GP}${path}`, { signal: AbortSignal.timeout(15_000), cache: "no-store" });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

async function tipHeight(): Promise<number | null> {
  try {
    const res = await fetch(`${ONESAT}/chaintracks/height`, { signal: AbortSignal.timeout(5_000), cache: "no-store" });
    return res.ok ? ((await res.json()) as { height: number }).height : null;
  } catch {
    return null;
  }
}

function tokenRef(r: TokenRow): RoomRef | null {
  return r.id ? parseRoom("bsv21", r.id) : r.tick ? parseRoom("bsv20", r.tick) : null;
}

function collectionId(r: OrdRow): string | null {
  const std = r.origin?.data?.map?.subTypeData;
  return typeof std === "object" && std?.collectionId ? std.collectionId : null;
}

async function build(): Promise<HotBoard> {
  const [trend, active, tip, usd, newTok, newOrd, soldTok, soldOrd] = await Promise.all([
    trending(12).catch(() => ({ tokens: [], collections: [] })),
    store.activeRooms(100).catch(() => []),
    tipHeight(),
    bsvUsd(),
    gp<TokenRow[]>(`/bsv20/market?sort=height&dir=desc&limit=40`),
    gp<OrdRow[]>(`/market?sort=recent&dir=desc&limit=40`),
    gp<TokenRow[]>(`/bsv20/market/sales?limit=25&dir=desc`),
    gp<OrdRow[]>(`/market/sales?limit=25&dir=desc`),
  ]);

  // Heat = recent trades + fresh listings + chat activity.
  type Acc = { ref: RoomRef; trades: number; newListings: number; chatMembers: number; chatMessages: number };
  const rooms = new Map<string, Acc>();
  const touch = (ref: RoomRef | null) => {
    if (!ref) return null;
    let a = rooms.get(ref.key);
    if (!a) rooms.set(ref.key, (a = { ref, trades: 0, newListings: 0, chatMembers: 0, chatMessages: 0 }));
    return a;
  };
  for (const t of [...trend.tokens, ...trend.collections]) {
    const a = touch(parseRoom(t.kind, t.id));
    if (a) a.trades += t.trades;
  }
  for (const r of newTok ?? []) {
    const a = touch(tokenRef(r));
    if (a) a.newListings++;
  }
  for (const r of newOrd ?? []) {
    const id = collectionId(r);
    const a = id ? touch(parseRoom("coll", id)) : null;
    if (a) a.newListings++;
  }
  for (const c of active) {
    const a = touch(roomFromKey(c.room));
    if (a) {
      a.chatMembers = c.members;
      a.chatMessages = c.messages;
    }
  }
  const heat = (a: Acc) => a.trades + a.newListings * 2 + a.chatMessages * 2 + a.chatMembers * 5;
  const ranked = [...rooms.values()].sort((x, y) => heat(y) - heat(x)).slice(0, 18);

  const enriched = await Promise.all(
    ranked.map(async (a): Promise<HotRoom | null> => {
      const meta = await roomMeta(a.ref.kind, a.ref.id);
      if (!meta) return null;
      const market = await roomMarket(a.ref).catch(() => null);
      return {
        kind: a.ref.kind,
        id: a.ref.id,
        title: meta.title,
        subtitle: meta.subtitle,
        image: meta.image,
        holders: meta.holders,
        trades: a.trades,
        newListings: a.newListings,
        chatMembers: a.chatMembers,
        chatMessages: a.chatMessages,
        floorSats: market?.floorSats ?? null,
        floorLabel: market?.floorLabel ?? null,
        heat: heat(a),
      };
    }),
  );

  const ago = (h?: number | null) => (h && tip ? Math.max(0, (tip - h) * 10) : null);
  const ticker: TickerItem[] = [];
  const pushToken = (r: TokenRow, event: TickerItem["event"]) => {
    const ref = tokenRef(r);
    if (!ref || !Number(r.price)) return;
    const sym = (r.sym ?? r.tick ?? "").replace(/^\$/, "");
    ticker.push({
      key: `${event}:${r.outpoint}`,
      event,
      kind: ref.kind,
      id: ref.id,
      label: `${formatAmount(BigInt(r.amt), r.dec)} $${sym}`,
      sats: Number(r.price),
      minutesAgo: ago(r.height),
    });
  };
  const pushOrd = (r: OrdRow, event: TickerItem["event"]) => {
    const id = collectionId(r);
    const price = r.data?.list?.price ?? 0;
    const ref = id ? parseRoom("coll", id) : null;
    if (!ref || !price) return;
    ticker.push({
      key: `${event}:${r.outpoint}`,
      event,
      kind: "coll",
      id: ref.id,
      label: r.origin?.data?.map?.name ?? "Collection item",
      sats: price,
      minutesAgo: ago(r.height),
    });
  };
  (newTok ?? []).slice(0, 12).forEach((r) => pushToken(r, "listed"));
  (newOrd ?? []).slice(0, 12).forEach((r) => pushOrd(r, "listed"));
  (soldTok ?? []).slice(0, 10).forEach((r) => pushToken(r, "sold"));
  (soldOrd ?? []).slice(0, 10).forEach((r) => pushOrd(r, "sold"));
  // Newest first; unconfirmed ("just now") at the front.
  ticker.sort((a, b) => (a.minutesAgo ?? -1) - (b.minutesAgo ?? -1));

  const board: HotBoard = {
    rooms: enriched.filter((r): r is HotRoom => !!r).slice(0, 12),
    ticker: ticker.slice(0, 30),
    usdPerBsv: usd,
    updatedAt: new Date().toISOString(),
  };
  if (!degraded(board)) {
    g.__ssHotGood = board;
    return board;
  }
  const good = g.__ssHotGood;
  return good
    ? {
        ...board,
        rooms: board.rooms.length ? board.rooms : good.rooms,
        ticker: board.ticker.length ? board.ticker : good.ticker,
        usdPerBsv: board.usdPerBsv ?? good.usdPerBsv,
      }
    : board;
}

// Shared across server instances (Vercel data cache), refreshed in the background every 60s.
// A degraded board throws so it isn't stored in the shared cache; callers fall back to the local one.
const sharedBoard = unstable_cache(
  async () => {
    const b = await localBoard();
    if (degraded(b)) throw new Error("degraded hot board");
    return b;
  },
  ["hot-board-v1"],
  { revalidate: 60 },
);

export async function hotBoard(): Promise<HotBoard> {
  try {
    return await sharedBoard();
  } catch {
    return localBoard(); // e.g. outside a Next request context
  }
}

/** Per-instance cache for 60s; concurrent callers share one build. */
async function localBoard(): Promise<HotBoard> {
  const hit = g.__ssHot;
  if (hit && hit.expires > Date.now()) return hit.value;
  g.__ssHotPending ??= build()
    .then((value) => {
      g.__ssHot = { value, expires: Date.now() + 60_000 };
      return value;
    })
    .finally(() => {
      g.__ssHotPending = undefined;
    });
  // Serve stale data while rebuilding, if we have any.
  return hit ? hit.value : g.__ssHotPending;
}

