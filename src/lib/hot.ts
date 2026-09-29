// The live "hot board" behind the landing page: which rooms are hottest right now, and a ticker of
// what's just been listed and sold. Built from 1sat-stack's market API plus chat activity.
import { unstable_cache } from "next/cache";
import { formatAmount, roomMeta } from "./indexer";
import { recentListings, type RecentListing } from "./listings";
import { roomMarket } from "./market";
import { bsvUsd } from "./price";
import { parseRoom, roomFromKey, type RoomKind, type RoomRef } from "./room-ref";
import { store } from "./store";

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

const g = globalThis as unknown as {
  __ssHot?: { value: HotBoard; expires: number };
  __ssHotPending?: Promise<HotBoard>;
  __ssHotGood?: HotBoard; // last board with real data, used when an upstream call fails
};

/** A board missing its rooms or ticker means an upstream API failed; don't let that blank the page. */
function degraded(b: HotBoard) {
  return b.rooms.length === 0 || b.ticker.length === 0;
}

async function tipHeight(): Promise<number | null> {
  try {
    const res = await fetch(`${ONESAT}/chaintracks/height`, { signal: AbortSignal.timeout(5_000), cache: "no-store" });
    return res.ok ? ((await res.json()) as { height: number }).height : null;
  } catch {
    return null;
  }
}

async function build(): Promise<HotBoard> {
  const [newListings, sales, active, tip, usd] = await Promise.all([
    recentListings("active").catch((): RecentListing[] => []),
    recentListings("sale").catch((): RecentListing[] => []),
    store.activeRooms(100).catch(() => []),
    tipHeight(),
    bsvUsd(),
  ]);

  // Heat = fresh listings + chat activity.
  type Acc = { ref: RoomRef; trades: number; newListings: number; chatMembers: number; chatMessages: number };
  const rooms = new Map<string, Acc>();
  const touch = (ref: RoomRef | null) => {
    if (!ref) return null;
    let a = rooms.get(ref.key);
    if (!a) rooms.set(ref.key, (a = { ref, trades: 0, newListings: 0, chatMembers: 0, chatMessages: 0 }));
    return a;
  };
  for (const l of newListings) {
    const a = touch(parseRoom(l.kind, l.id));
    if (a) a.newListings++;
  }
  for (const l of sales) {
    const a = touch(parseRoom(l.kind, l.id));
    if (a) a.trades++;
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
  for (const l of [...newListings.slice(0, 20), ...sales.slice(0, 10)]) {
    let label = l.name ?? "Collection item";
    if (l.kind === "bsv21" && l.amount) {
      const meta = await roomMeta("bsv21", l.id);
      if (!meta) continue;
      label = `${formatAmount(BigInt(l.amount), meta.dec)} ${meta.title}`;
    }
    ticker.push({ key: `${l.event}:${l.outpoint}`, event: l.event, kind: l.kind, id: l.id, label, sats: l.priceSats, minutesAgo: ago(l.height) });
  }
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
  ["hot-board-v3"],
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

