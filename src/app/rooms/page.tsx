import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ConnectPrompt } from "@/components/account-button";
import { RefreshHoldings } from "@/components/refresh-holdings";
import { RoomAvatar } from "@/components/room-card";
import { eligibleRooms, roomPath, type EligibleRoom } from "@/lib/rooms";
import { getSession, type Session } from "@/lib/session";
import { store } from "@/lib/store";

export const metadata: Metadata = { title: "My rooms · 1satsocial" };

const KIND: Record<string, string> = { bsv21: "BSV-21 token", bsv20: "BSV-20 token", coll: "Collection" };

export default async function MyRoomsPage() {
  const session = await getSession();
  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-10">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">My rooms</h1>
          <p className="mt-1 text-muted">Every room your wallet can enter right now.</p>
        </div>
        {session && <RefreshHoldings />}
      </div>

      {!session ? (
        <div className="flex flex-col items-center rounded-2xl border border-line bg-panel px-6 py-14 text-center">
          <h2 className="text-xl font-medium">Connect to see your rooms</h2>
          <p className="mb-6 mt-2 max-w-md text-muted">
            Sign in with Yours Wallet and we&apos;ll find every token and collection you hold. Each one is a room you can walk
            straight into.
          </p>
          <ConnectPrompt />
        </div>
      ) : (
        <Suspense fallback={<ListSkeleton />}>
          <RoomsList session={session} />
        </Suspense>
      )}
    </div>
  );
}

async function RoomsList({ session }: { session: Session }) {
  const [rooms, activity] = await Promise.all([eligibleRooms(session), store.activeRooms(200).catch(() => [])]);
  if (rooms.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-line p-8 text-center">
        <p className="font-medium">No rooms yet</p>
        <p className="mx-auto mt-2 max-w-md text-sm text-muted">
          We didn&apos;t find any 1Sat tokens or collection items at your verified keys. Bought something just now? Choose
          Refresh holdings. Otherwise, find something hot and buy in.
        </p>
        <Link href="/" className="mt-5 inline-block rounded-full bg-gold px-5 py-2 text-sm font-medium text-black hover:brightness-110">
          See what&apos;s hot
        </Link>
      </div>
    );
  }
  const chat = new Map(activity.map((a) => [a.room, a]));
  return (
    <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-panel">
      {rooms.map((r) => (
        <RoomRow key={r.key} room={r} members={chat.get(r.key)?.members ?? 0} messages={chat.get(r.key)?.messages ?? 0} />
      ))}
    </ul>
  );
}

function RoomRow({ room, members, messages }: { room: EligibleRoom; members: number; messages: number }) {
  return (
    <li className="flex items-center gap-4 p-4 transition hover:bg-panel-2">
      <RoomAvatar title={room.title} image={room.image} size="h-14 w-14" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Link href={roomPath(room)} className="font-medium hover:text-gold">
            {room.title}
          </Link>
          <span className="rounded border border-line px-1.5 text-[10px] uppercase tracking-wide text-muted">{KIND[room.kind]}</span>
          {room.confirming && (
            <span className="rounded-full bg-gold/15 px-2 py-0.5 text-[11px] text-gold" title="Verified on the network; waiting for the next block">
              confirming
            </span>
          )}
        </div>
        <p className="mt-0.5 text-sm text-muted">
          You hold <span className="text-text">{room.holding}</span>
          {members > 0 ? ` · ${members} chatting · ${messages} messages` : " · quiet, be the first to post"}
        </p>
      </div>
      <Link
        href={roomPath(room)}
        className="shrink-0 rounded-full bg-gold px-5 py-2 text-sm font-medium text-black transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
      >
        Enter chat
      </Link>
    </li>
  );
}

function ListSkeleton() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 3 }, (_, i) => (
        <div key={i} className="h-[86px] animate-pulse rounded-2xl border border-line bg-panel" />
      ))}
    </div>
  );
}
