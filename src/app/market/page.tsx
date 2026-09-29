import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { RoomAvatar } from "@/components/room-card";
import { roomMeta } from "@/lib/indexer";
import { listingActivity, type Activity } from "@/lib/listings";
import { roomMarket } from "@/lib/market";
import { parseRoom, roomFromKey, roomPath, type RoomKind } from "@/lib/room-ref";
import { store, type RoomActivity } from "@/lib/store";

export const metadata: Metadata = { title: "Market · 1satsocial" };

const TABS = [
  { key: "all", label: "All" },
  { key: "tokens", label: "Tokens" },
  { key: "collections", label: "Collections" },
] as const;
type Tab = (typeof TABS)[number]["key"];

const KIND_LABEL: Record<RoomKind, string> = { bsv21: "BSV-21", bsv20: "BSV-20", coll: "Collection" };

export default async function MarketPage({ searchParams }: PageProps<"/market">) {
  const raw = (await searchParams).tab;
  const tab: Tab = TABS.some((t) => t.key === raw) ? (raw as Tab) : "all";
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-10">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Market</h1>
          <p className="mt-1 text-muted">
            Trending rooms, ranked by recent marketplace listings, sales and chat activity. Buy in with Yours and you&apos;re in the room.
          </p>
        </div>
        <nav className="flex gap-1 rounded-full border border-line bg-panel p-1 text-sm">
          {TABS.map((t) => (
            <Link
              key={t.key}
              href={t.key === "all" ? "/market" : `/market?tab=${t.key}`}
              className={`rounded-full px-4 py-1.5 ${t.key === tab ? "bg-gold text-black" : "text-muted hover:text-text"}`}
            >
              {t.label}
            </Link>
          ))}
        </nav>
      </div>
      <Suspense key={tab} fallback={<TableSkeleton />}>
        <MarketTable tab={tab} />
      </Suspense>
    </div>
  );
}

type Row = { kind: RoomKind; id: string; trades: number; chat: RoomActivity | null; score: number };

async function MarketTable({ tab }: { tab: Tab }) {
  const [{ tokens, collections }, active] = await Promise.all([
    listingActivity(15).catch(() => ({ tokens: [] as Activity[], collections: [] as Activity[] })),
    store.activeRooms(100),
  ]);

  const rows = new Map<string, Row>();
  for (const t of [...tokens, ...collections]) {
    rows.set(`${t.kind}:${t.id}`, { kind: t.kind, id: t.id, trades: t.listings, chat: null, score: t.listings });
  }
  for (const a of active) {
    const ref = roomFromKey(a.room);
    if (!ref) continue;
    const row = rows.get(ref.key) ?? { kind: ref.kind, id: ref.id, trades: 0, chat: null, score: 0 };
    // A chatting room counts like trading activity: messages weighted over the 30-day window.
    row.chat = a;
    row.score += a.messages * 2 + a.members * 5;
    rows.set(ref.key, row);
  }

  const filtered = [...rows.values()]
    .filter((r) => (tab === "tokens" ? r.kind !== "coll" : tab === "collections" ? r.kind === "coll" : true))
    .sort((a, b) => b.score - a.score)
    .slice(0, 24);

  const enriched = await Promise.all(
    filtered.map(async (r) => {
      const ref = parseRoom(r.kind, r.id);
      const [meta, market] = await Promise.all([roomMeta(r.kind, r.id), ref ? roomMarket(ref) : null]);
      return { ...r, meta, floor: market?.floorLabel ?? null, buyable: market?.listings.some((l) => l.buyable) ?? false };
    }),
  );
  const shown = enriched.filter((r) => r.meta);

  if (shown.length === 0) {
    return <p className="rounded-xl border border-dashed border-line p-6 text-sm text-muted">Market data is unavailable right now.</p>;
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-line">
      <div className="hidden grid-cols-[2rem_1fr_7rem_7rem_9rem_8rem_8rem] gap-4 border-b border-line bg-panel px-4 py-2.5 text-xs uppercase tracking-wide text-muted md:grid">
        <span>#</span>
        <span>Room</span>
        <span className="text-right">Activity</span>
        <span className="text-right">Holders</span>
        <span className="text-right">Floor</span>
        <span className="text-right">Chat</span>
        <span />
      </div>
      <ol>
        {shown.map((r, i) => (
          <li
            key={`${r.kind}:${r.id}`}
            className="grid grid-cols-[1fr_auto] items-center gap-3 border-b border-line px-4 py-3 last:border-0 hover:bg-panel md:grid-cols-[2rem_1fr_7rem_7rem_9rem_8rem_8rem] md:gap-4"
          >
            <span className="hidden text-sm text-muted md:block">{i + 1}</span>
            <Link href={roomPath(r)} className="flex min-w-0 items-center gap-3">
              <RoomAvatar title={r.meta!.title} image={r.meta!.image} size="h-10 w-10" />
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium hover:text-gold">{r.meta!.title}</span>
                  <span className="shrink-0 rounded border border-line px-1.5 text-[10px] uppercase tracking-wide text-muted">
                    {KIND_LABEL[r.kind]}
                  </span>
                </div>
                <p className="truncate text-xs text-muted md:hidden">
                  {r.trades} listings & sales{r.floor ? ` · floor ${r.floor}` : ""}
                  {r.chat ? ` · ${r.chat.members} chatting` : ""}
                </p>
              </div>
            </Link>
            <span className="hidden text-right text-sm tabular-nums md:block">{r.trades || "–"}</span>
            <span className="hidden text-right text-sm tabular-nums md:block">{r.meta!.holders?.toLocaleString() ?? "–"}</span>
            <span className="hidden text-right text-sm tabular-nums text-gold md:block">{r.floor ?? "–"}</span>
            <span className="hidden text-right text-sm tabular-nums md:block">
              {r.chat ? `${r.chat.members} · ${r.chat.messages} msgs` : <span className="text-muted">quiet</span>}
            </span>
            <Link
              href={roomPath(r)}
              className={`justify-self-end rounded-full px-4 py-1.5 text-sm ${
                r.buyable ? "bg-gold font-medium text-black hover:brightness-110" : "border border-line hover:border-gold/50"
              }`}
            >
              {r.buyable ? "Buy & enter" : "View room"}
            </Link>
          </li>
        ))}
      </ol>
    </div>
  );
}

function TableSkeleton() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="h-16 animate-pulse rounded-xl border border-line bg-panel" />
      ))}
    </div>
  );
}
