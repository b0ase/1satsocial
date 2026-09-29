import Link from "next/link";
import { Suspense } from "react";
import { ConnectPrompt } from "@/components/account-button";
import { OpenRoom } from "@/components/open-room";
import { RoomCard } from "@/components/room-card";
import { roomMeta, trending } from "@/lib/indexer";
import { eligibleRooms, roomFromKey } from "@/lib/rooms";
import { getSession, type Session } from "@/lib/session";
import { store } from "@/lib/store";

export default async function Home() {
  const session = await getSession();
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-12">
      <section className="grid gap-10 md:grid-cols-[1.2fr_1fr] md:items-end">
        <div>
          <p className="mb-4 text-sm uppercase tracking-[0.2em] text-gold">For Yours Wallet holders</p>
          <h1 className="text-4xl font-semibold leading-tight tracking-tight md:text-6xl">
            Every token is a room.
            <br />
            <span className="text-muted">Only holders get in.</span>
          </h1>
          <p className="mt-5 max-w-xl text-lg text-muted">
            Each BSV-21 token, BSV-20 tick and 1Sat Ordinals collection has its own group chat. Sign in with Yours and
            you&apos;re in every room you hold. Sell the token and you&apos;re out.
          </p>
          {!session && (
            <div className="mt-8">
              <ConnectPrompt big />
            </div>
          )}
        </div>
        <div className="rounded-2xl border border-line bg-panel p-5">
          <h2 className="mb-1 font-medium">Jump into a room</h2>
          <p className="mb-4 text-sm text-muted">Anyone can look. Only holders can read and post.</p>
          <OpenRoom />
        </div>
      </section>

      <section id="trending" className="mt-14 scroll-mt-20">
        <div className="mb-4 flex items-baseline justify-between gap-4">
          <h2 className="text-lg font-medium">Trending on 1sat.market</h2>
          <div className="flex items-baseline gap-4">
            <p className="hidden text-sm text-muted sm:block">Most traded recently. Hold one to get in.</p>
            <Link href="/market" className="text-sm text-gold hover:underline">
              Full market →
            </Link>
          </div>
        </div>
        <Suspense fallback={<GridSkeleton />}>
          <TrendingRooms />
        </Suspense>
      </section>

      {session && (
        <section className="mt-16">
          <h2 className="mb-4 text-lg font-medium">Your rooms</h2>
          <Suspense fallback={<GridSkeleton />}>
            <YourRooms session={session} />
          </Suspense>
        </section>
      )}

      <section className="mt-16">
        <h2 className="mb-4 text-lg font-medium">Active now</h2>
        <Suspense fallback={<GridSkeleton />}>
          <ActiveRooms />
        </Suspense>
      </section>


      <section className="mt-20 grid gap-6 border-t border-line pt-10 md:grid-cols-3">
        {[
          ["Verified on-chain", "Holdings are checked on the server against the 1Sat indexer, never taken from your browser."],
          ["Access follows the token", "Eligibility is re-checked every minute. Buy in and you're a member. Sell and you lose access."],
          ["No new account", "Your Yours Wallet is your login. You sign a message to prove your keys. Nothing is spent."],
        ].map(([t, d]) => (
          <div key={t}>
            <h3 className="font-medium text-gold">{t}</h3>
            <p className="mt-1 text-sm text-muted">{d}</p>
          </div>
        ))}
      </section>
    </div>
  );
}

async function YourRooms({ session }: { session: Session }) {
  const rooms = session.addresses.length ? await eligibleRooms(session) : [];
  if (rooms.length === 0) {
    return (
      <Empty>
        <span className="block font-medium text-text">You don&apos;t hold any 1Sat tokens or collection items yet.</span>
        <span className="mt-1 block">
          Pick a room from <a href="#trending" className="text-gold underline">Trending</a> below, buy in on{" "}
          <a href="https://1sat.market" className="text-gold underline" target="_blank" rel="noreferrer">
            1sat.market
          </a>
          , then choose <em>Refresh holdings</em> in the account menu. Assets from an older Yours version need to be
          imported into your current wallet first.
        </span>
      </Empty>
    );
  }
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {rooms.map((r) => (
        <RoomCard key={r.key} kind={r.kind} id={r.id} title={r.title} image={r.image} detail={`You hold ${r.holding}`} />
      ))}
    </div>
  );
}

async function ActiveRooms() {
  const active = await store.activeRooms(12);
  if (active.length === 0) return <Empty>No conversations yet. Open your token&apos;s room and say gm.</Empty>;
  const rooms = await Promise.all(
    active.map(async (a) => {
      const ref = roomFromKey(a.room);
      return ref ? { ...ref, a, meta: await roomMeta(ref.kind, ref.id) } : null;
    }),
  );
  return (
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
  );
}

async function TrendingRooms() {
  const { tokens, collections } = await trending(6).catch(() => ({ tokens: [], collections: [] }));
  const items = await Promise.all(
    [...tokens, ...collections].map(async (t) => ({ ...t, meta: await roomMeta(t.kind, t.id) })),
  );
  const shown = items.filter((i) => i.meta);
  if (shown.length === 0) return <Empty>Market data is unavailable right now.</Empty>;
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {shown.map((i) => (
        <RoomCard
          key={`${i.kind}:${i.id}`}
          kind={i.kind}
          id={i.id}
          title={i.meta!.title}
          image={i.meta!.image}
          detail={[`${i.trades} recent trades`, i.meta!.holders ? `${i.meta!.holders.toLocaleString()} holders` : null]
            .filter(Boolean)
            .join(" · ")}
        />
      ))}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-xl border border-dashed border-line p-6 text-sm text-muted">{children}</p>;
}

function GridSkeleton() {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 3 }, (_, i) => (
        <div key={i} className="h-[70px] animate-pulse rounded-xl border border-line bg-panel" />
      ))}
    </div>
  );
}
