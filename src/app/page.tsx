import Link from "next/link";
import { Suspense } from "react";
import { HotBoard } from "@/components/hot-board";
import { OpenRoom } from "@/components/open-room";
import { RoomAvatar, RoomCard } from "@/components/room-card";
import { hotBoard } from "@/lib/hot";
import { roomMeta } from "@/lib/indexer";
import { eligibleRooms, roomFromKey, roomPath } from "@/lib/rooms";
import { getSession, type Session } from "@/lib/session";
import { store } from "@/lib/store";

export default async function Home() {
  const session = await getSession(); // header carries the connect button
  return (
    <div className="mx-auto w-full max-w-6xl px-4 pb-20 pt-10 sm:pt-14">
      <section className="flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-2xl">
          <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-muted">
            <span className="animate-live h-1.5 w-1.5 rounded-full bg-emerald-400" />
            Live from the 1Sat marketplace
          </p>
          <h1 className="mt-4 text-4xl font-semibold leading-[1.02] tracking-tight sm:text-6xl">
            Every token is a room.{" "}
            <span className="bg-gradient-to-r from-gold via-[#f5d48a] to-gold bg-clip-text text-transparent">
              Only holders get in.
            </span>
          </h1>
          <p className="mt-4 max-w-xl text-lg text-muted">
            Group chats for every BSV-21 token, BSV-20 tick and 1Sat collection. Hold it and you&apos;re in. Don&apos;t
            yet? Buy in with Yours in one step.
          </p>
        </div>
        <div className="w-full max-w-sm lg:pb-2">
          <OpenRoom />
        </div>
      </section>

      {session && (
        <Suspense fallback={<StripSkeleton />}>
          <YourRooms session={session} />
        </Suspense>
      )}

      <Suspense fallback={<BoardSkeleton />}>
        <LiveBoard session={session} />
      </Suspense>

      <Suspense fallback={null}>
        <ChattingNow />
      </Suspense>

      <section className="mt-20 grid gap-8 border-t border-line pt-10 md:grid-cols-3">
        {[
          ["Verified on-chain", "Holdings are checked on the server against the chain, never taken from your browser."],
          ["Instant entry", "Buy a listing and the room opens the moment your purchase hits the network. No waiting for a block."],
          ["Access follows the token", "Sell the token and you're out. Every room is its holders, nobody else."],
        ].map(([t, d]) => (
          <div key={t}>
            <h3 className="font-medium text-gold">{t}</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-muted">{d}</p>
          </div>
        ))}
      </section>
    </div>
  );
}

async function LiveBoard({ session }: { session: Session | null }) {
  const [board, mine] = await Promise.all([
    hotBoard(),
    session?.addresses.length ? eligibleRooms(session).catch(() => []) : Promise.resolve([]),
  ]);
  if (!board.rooms.length) {
    return <Empty>Market data is unavailable right now. Try again in a moment.</Empty>;
  }
  return <HotBoard initial={board} heldKeys={mine.map((r) => r.key)} />;
}

/** Signed-in users see the rooms they can walk into, first. */
async function YourRooms({ session }: { session: Session }) {
  const rooms = session.addresses.length ? await eligibleRooms(session) : [];
  return (
    <section className="mt-10" aria-labelledby="your-rooms">
      <div className="mb-3 flex items-baseline justify-between gap-4">
        <h2 id="your-rooms" className="text-sm font-medium uppercase tracking-[0.14em] text-muted">
          Your rooms {rooms.length > 0 && <span className="text-gold">· {rooms.length}</span>}
        </h2>
        <Link href="/rooms" className="text-sm text-gold hover:underline">
          {rooms.length ? "All my rooms →" : "Refresh holdings →"}
        </Link>
      </div>
      {rooms.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-line px-5 py-4 text-sm text-muted">
          No rooms yet. Pick something hot below and buy in: the room opens straight away.
        </p>
      ) : (
        <ul className="flex gap-3 overflow-x-auto pb-2 [scrollbar-width:thin]">
          {rooms.map((r) => (
            <li key={r.key} className="shrink-0">
              <Link
                href={roomPath(r)}
                className="group flex items-center gap-3 rounded-2xl border border-gold/30 bg-gold-soft py-2 pl-2 pr-4 transition hover:border-gold/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"
              >
                <RoomAvatar title={r.title} image={r.image} size="h-10 w-10" />
                <span className="flex flex-col">
                  <span className="text-sm font-medium group-hover:text-gold">{r.title}</span>
                  <span className="text-xs text-muted">
                    {r.holding}
                    {r.confirming ? " · confirming" : ""}
                  </span>
                </span>
                <span className="ml-2 rounded-full bg-gold px-3 py-1 text-xs font-medium text-black">Enter</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

async function ChattingNow() {
  const active = await store.activeRooms(9);
  if (active.length === 0) return null;
  const rooms = await Promise.all(
    active.map(async (a) => {
      const ref = roomFromKey(a.room);
      return ref ? { ...ref, a, meta: await roomMeta(ref.kind, ref.id) } : null;
    }),
  );
  return (
    <section className="mt-16">
      <div className="mb-5 flex items-end justify-between gap-4">
        <h2 className="text-2xl font-semibold tracking-tight">Chatting now</h2>
        <Link href="/market" className="text-sm text-gold hover:underline">
          All rooms →
        </Link>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {rooms.map(
          (r) =>
            r && (
              <RoomCard
                key={r.key}
                kind={r.kind}
                id={r.id}
                title={r.meta?.title ?? r.id.slice(0, 12)}
                image={r.meta?.image ?? null}
                detail={`${r.a.members} member${r.a.members === 1 ? "" : "s"} · ${r.a.messages} messages`}
              />
            ),
        )}
      </div>
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-2xl border border-dashed border-line p-6 text-sm text-muted">{children}</p>;
}

function StripSkeleton() {
  return <div className="mt-10 h-[84px] animate-pulse rounded-2xl border border-line bg-panel" />;
}

function BoardSkeleton() {
  return (
    <div className="mt-8 space-y-6">
      <div className="h-[460px] animate-pulse rounded-3xl border border-line bg-panel" />
      <div className="h-12 animate-pulse rounded-2xl border border-line bg-panel" />
    </div>
  );
}
