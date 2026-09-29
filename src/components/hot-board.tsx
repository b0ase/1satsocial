"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { HotBoard as Board, HotRoom, TickerItem } from "@/lib/hot";
import { formatUsd } from "@/lib/price";
import { roomPath, type RoomKind } from "@/lib/room-ref";

const REFRESH_MS = 30_000;
const SPOTLIGHT = 6;
const KIND: Record<RoomKind, string> = { bsv21: "BSV-21 token", bsv20: "BSV-20 token", coll: "Collection" };

function sats(n: number) {
  if (n >= 1e8) return `${(n / 1e8).toLocaleString("en-US", { maximumFractionDigits: 3 })} BSV`;
  if (n >= 1) return `${Math.round(n).toLocaleString("en-US")} sats`;
  return `${n.toPrecision(2)} sats`;
}

function ago(m: number | null) {
  if (m === null) return "just now";
  if (m < 60) return `${m}m ago`;
  if (m < 60 * 24) return `${Math.round(m / 60)}h ago`;
  return `${Math.round(m / 1440)}d ago`;
}

function Art({ room, className = "" }: { room: Pick<HotRoom, "image" | "title">; className?: string }) {
  // Inscriptions can be slow, huge or in formats the browser can't show: fall back to initials, never a broken icon.
  const [failed, setFailed] = useState<string | null>(null);
  return room.image && failed !== room.image ? (
    // Inscription content from ORDFS in arbitrary formats: plain img on purpose.
    // eslint-disable-next-line @next/next/no-img-element
    <img src={room.image} alt="" onError={() => setFailed(room.image)} className={`object-cover ${className}`} />
  ) : (
    <div className={`grid place-items-center bg-gradient-to-br from-gold/30 via-panel-2 to-panel text-gold ${className}`}>
      <span className="text-[length:inherit] font-semibold">{room.title.replace("$", "").slice(0, 2)}</span>
    </div>
  );
}

/** Live marketplace board: rotating spotlight, activity ticker, and the hot grid. Refreshes itself. */
export function HotBoard({ initial }: { initial: Board }) {
  const [board, setBoard] = useState(initial);

  useEffect(() => {
    const t = setInterval(async () => {
      if (document.hidden) return;
      const res = await fetch("/api/hot").catch(() => null);
      if (res?.ok) setBoard(await res.json());
    }, REFRESH_MS);
    return () => clearInterval(t);
  }, []);

  return (
    <>
      <Spotlight rooms={board.rooms.slice(0, SPOTLIGHT)} usd={board.usdPerBsv} />
      <Ticker items={board.ticker} usd={board.usdPerBsv} />
      <HotGrid rooms={board.rooms} usd={board.usdPerBsv} />
    </>
  );
}

function Stat({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div className="flex flex-col">
      <span className="text-[11px] uppercase tracking-[0.14em] text-muted">{label}</span>
      <span className={`mt-1 text-2xl font-semibold tabular-nums tracking-tight ${accent ? "text-gold" : ""}`}>{value}</span>
      {sub && <span className="text-xs tabular-nums text-muted">{sub}</span>}
    </div>
  );
}

function Spotlight({ rooms, usd }: { rooms: HotRoom[]; usd: number | null }) {
  const [index, setIndex] = useState(0);
  const i = rooms.length ? index % rooms.length : 0;
  const room = rooms[i];
  if (!room) return null;
  const perToken = room.kind !== "coll";

  return (
    <section aria-label="Trending now" className="pause-on-hover relative mt-8 overflow-hidden rounded-3xl border border-line bg-panel">
      {/* Ambient backdrop from the artwork itself */}
      <div key={`bg-${room.kind}:${room.id}`} aria-hidden className="animate-rise pointer-events-none absolute inset-0">
        {room.image && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={room.image} alt="" className="h-full w-full scale-125 object-cover opacity-30 blur-3xl saturate-150" />
        )}
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,var(--gold-soft),transparent_60%)]" />
        <div className="absolute inset-0 bg-gradient-to-r from-panel via-panel/85 to-panel/40" />
      </div>

      <div className="relative grid gap-8 p-6 sm:p-10 md:grid-cols-[minmax(0,300px)_1fr] md:items-center md:gap-12">
        <Link
          key={`art-${room.kind}:${room.id}`}
          href={roomPath(room)}
          className="animate-rise group relative mx-auto block aspect-square w-56 sm:w-64 md:w-full"
        >
          <div className="absolute -inset-6 rounded-[2rem] bg-gold/20 opacity-60 blur-2xl transition-opacity duration-300 group-hover:opacity-90" />
          <div className="animate-float relative h-full w-full overflow-hidden rounded-3xl shadow-2xl ring-1 ring-white/10">
            <Art room={room} className="h-full w-full text-7xl" />
          </div>
        </Link>

        <div key={`copy-${room.kind}:${room.id}`} className="animate-rise min-w-0">
          <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-gold">
            <span className="animate-live h-2 w-2 rounded-full bg-emerald-400" />
            Live · #{i + 1} hottest on 1Sat
          </p>
          <h2 className="mt-3 break-words text-5xl font-semibold leading-[0.95] tracking-tight sm:text-6xl lg:text-7xl">{room.title}</h2>
          <p className="mt-3 text-muted">
            {KIND[room.kind]} · holder-only chat room
          </p>

          <div className="mt-8 grid grid-cols-2 gap-x-8 gap-y-5 sm:grid-cols-4">
            {room.floorSats !== null && (
              <Stat
                label={perToken ? "Floor / token" : "Floor"}
                value={usd ? formatUsd(room.floorSats, usd) : sats(room.floorSats)}
                sub={usd ? sats(room.floorSats) : undefined}
                accent
              />
            )}
            <Stat label="Recent trades" value={room.trades.toLocaleString("en-US")} />
            <Stat label="New listings" value={room.newListings.toLocaleString("en-US")} />
            {room.holders ? (
              <Stat label="Holders" value={room.holders.toLocaleString("en-US")} />
            ) : (
              <Stat label="Chatting" value={room.chatMembers.toLocaleString("en-US")} />
            )}
          </div>

          <div className="mt-9 flex flex-wrap gap-3">
            <Link
              href={roomPath(room)}
              className="rounded-full bg-gold px-6 py-3 font-medium text-black shadow-[0_0_40px_-8px_var(--gold)] transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
            >
              Buy in &amp; join the chat
            </Link>
            <Link
              href={roomPath(room)}
              className="rounded-full border border-line bg-bg/40 px-6 py-3 font-medium backdrop-blur transition hover:border-gold/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
            >
              See listings
            </Link>
          </div>
        </div>
      </div>

      {/* Story-style selector: each bar fills, then advances. Hover pauses. */}
      <div className="relative grid grid-cols-3 gap-px border-t border-line bg-line sm:grid-cols-6">
        {rooms.map((r, n) => (
          <button
            key={`${r.kind}:${r.id}`}
            onClick={() => setIndex(n)}
            aria-label={`Show ${r.title}`}
            aria-current={n === i}
            className={`group relative flex items-center gap-2.5 bg-panel px-3 py-3 text-left transition hover:bg-panel-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-gold ${
              n === i ? "bg-panel-2" : ""
            }`}
          >
            <span className="absolute inset-x-0 top-0 h-0.5 bg-line">
              {n === i && (
                <span
                  key={`p-${index}`}
                  onAnimationEnd={() => setIndex((x) => x + 1)}
                  className="animate-progress block h-full origin-left bg-gold"
                />
              )}
              {n < i && <span className="block h-full bg-gold/40" />}
            </span>
            <span className="h-8 w-8 shrink-0 overflow-hidden rounded-md ring-1 ring-white/10">
              <Art room={r} className="h-full w-full text-xs" />
            </span>
            <span className={`truncate text-sm ${n === i ? "text-text" : "text-muted group-hover:text-text"}`}>{r.title}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

function TickerRow({ t, usd }: { t: TickerItem; usd: number | null }) {
  return (
    <Link
      href={roomPath(t)}
      className="flex shrink-0 items-center gap-2.5 whitespace-nowrap px-5 text-sm transition hover:text-gold focus-visible:outline-none focus-visible:text-gold"
    >
      <span
        className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
          t.event === "sold" ? "bg-emerald-400/15 text-emerald-300" : "bg-gold/15 text-gold"
        }`}
      >
        {t.event === "sold" ? "Sold" : "Just listed"}
      </span>
      <span className="font-medium">{t.label}</span>
      <span className="tabular-nums text-muted">{usd ? formatUsd(t.sats, usd) : sats(t.sats)}</span>
      <span className="text-xs text-muted/70">{ago(t.minutesAgo)}</span>
      <span aria-hidden className="pl-3 text-line">
        /
      </span>
    </Link>
  );
}

function Ticker({ items, usd }: { items: TickerItem[]; usd: number | null }) {
  if (!items.length) return null;
  return (
    <section aria-label="Live marketplace activity" className="pause-on-hover relative mt-6 overflow-hidden rounded-2xl border border-line bg-panel/60">
      <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-16 bg-gradient-to-r from-bg to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-16 bg-gradient-to-l from-bg to-transparent" />
      <div className="animate-marquee flex w-max py-3 motion-reduce:w-full motion-reduce:overflow-x-auto" style={{ ["--marquee-duration" as string]: `${Math.max(40, items.length * 4)}s` }}>
        {/* Two copies so the loop is seamless; the second is hidden from assistive tech. */}
        {items.map((t) => (
          <TickerRow key={t.key} t={t} usd={usd} />
        ))}
        <div aria-hidden className="flex motion-reduce:hidden">
          {items.map((t) => (
            <TickerRow key={`dup-${t.key}`} t={t} usd={usd} />
          ))}
        </div>
      </div>
    </section>
  );
}

function Flame() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden className="h-3.5 w-3.5 fill-current">
      <path d="M8.6 1.2c.3 2-.7 3.2-1.8 4.4C5.7 6.8 4.5 8 4.5 10a3.5 3.5 0 0 0 7 0c0-1.3-.5-2.3-1.1-3.1-.2.9-.7 1.5-1.4 1.8.5-2.4-.1-5.3-.4-7.5Z" />
    </svg>
  );
}

function HotGrid({ rooms, usd }: { rooms: HotRoom[]; usd: number | null }) {
  if (!rooms.length) return null;
  const top = rooms[0]?.heat || 1;
  return (
    <section className="mt-16" aria-labelledby="hot-heading">
      <div className="mb-5 flex items-end justify-between gap-4">
        <div>
          <h2 id="hot-heading" className="text-2xl font-semibold tracking-tight">
            Hot right now
          </h2>
          <p className="mt-1 text-sm text-muted">Ranked by trades, fresh listings and chat. Updates every 30 seconds.</p>
        </div>
        <Link href="/market" className="shrink-0 text-sm text-gold hover:underline">
          Full market →
        </Link>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {rooms.map((r, n) => (
          <Link
            key={`${r.kind}:${r.id}`}
            href={roomPath(r)}
            className="group relative overflow-hidden rounded-2xl border border-line bg-panel transition duration-200 hover:-translate-y-0.5 hover:border-gold/50 hover:shadow-[0_18px_50px_-20px_var(--gold)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
          >
            <div className="relative aspect-[4/3] overflow-hidden">
              <Art room={r} className="h-full w-full text-4xl transition duration-500 group-hover:scale-105" />
              <div className="absolute inset-0 bg-gradient-to-t from-panel via-panel/10 to-transparent" />
              <span className="absolute left-2.5 top-2.5 rounded-full bg-bg/70 px-2 py-0.5 text-xs font-semibold tabular-nums backdrop-blur">
                #{n + 1}
              </span>
              <span className="absolute right-2.5 top-2.5 flex items-center gap-1 rounded-full bg-bg/70 px-2 py-0.5 text-xs text-gold backdrop-blur">
                <Flame />
                {Math.max(1, Math.round((r.heat / top) * 100))}
              </span>
            </div>
            <div className="p-3.5">
              <p className="truncate font-medium group-hover:text-gold">{r.title}</p>
              <p className="mt-0.5 truncate text-xs text-muted">
                {KIND[r.kind]} · {r.trades} trades{r.newListings ? ` · ${r.newListings} new` : ""}
              </p>
              {r.floorSats !== null && (
                <p className="mt-2 text-sm tabular-nums">
                  <span className="text-muted">Floor </span>
                  <span className="font-medium text-gold">{usd ? formatUsd(r.floorSats, usd) : sats(r.floorSats)}</span>
                  {r.kind !== "coll" && <span className="text-xs text-muted"> /token</span>}
                </p>
              )}
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
