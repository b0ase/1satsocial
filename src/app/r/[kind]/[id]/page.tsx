import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ConnectPrompt } from "@/components/account-button";
import { ChatRoom } from "@/components/chat-room";
import { ProveHolding } from "@/components/prove-holding";
import { RoomAvatar } from "@/components/room-card";
import { roomMeta } from "@/lib/indexer";
import { BuyPanel } from "@/components/buy-panel";
import { IndexingFund } from "@/components/indexing-fund";
import { tokenIndexing } from "@/lib/overlay";
import { marketUrl, roomMarket } from "@/lib/market";
import { bsvUsd } from "@/lib/price";
import { checkAccess, parseRoom } from "@/lib/rooms";
import { getSession } from "@/lib/session";
import { store } from "@/lib/store";

export async function generateMetadata({ params }: PageProps<"/r/[kind]/[id]">): Promise<Metadata> {
  const { kind, id } = await params;
  const room = parseRoom(kind, id);
  const meta = room ? await roomMeta(room.kind, room.id) : null;
  const title = meta ? `${meta.title} holders · 1satsocial` : "Room · 1satsocial";
  const description = meta
    ? `The holder-only chat for ${meta.title}${meta.holders ? `, one of ${meta.holders.toLocaleString("en-US")} holders on-chain` : ""}. Hold it to join, or buy in with Yours Wallet.`
    : "A holder-only chat room on 1satsocial.";
  return {
    title,
    description,
    openGraph: { title, description, type: "website", siteName: "1satsocial" },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function RoomPage({ params }: PageProps<"/r/[kind]/[id]">) {
  const { kind, id } = await params;
  const room = parseRoom(kind, id);
  if (!room) notFound();

  const [session, meta, indexing, usdPerBsv] = await Promise.all([
    getSession(),
    roomMeta(room.kind, room.id),
    room.kind === "bsv21" ? tokenIndexing(room.id) : null,
    bsvUsd(),
  ]);
  const access = await checkAccess(session, room, meta);
  const title = meta?.title ?? room.id.slice(0, 12);

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col px-4 py-6">
      <div className="mb-4 flex items-center gap-4">
        <RoomAvatar title={title} image={meta?.image ?? null} size="h-14 w-14" />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="truncate text-sm text-muted">
            {meta?.subtitle ?? "Unknown token"}
            {meta?.holders ? ` · ${meta.holders.toLocaleString()} holders on-chain` : ""}
          </p>
        </div>
        {access.ok && (
          <span className="hidden rounded-full border border-gold/40 bg-gold-soft px-3 py-1 text-sm text-gold sm:block">
            You hold {access.holding}
          </span>
        )}
      </div>

      {indexing && meta && <IndexingFund symbol={meta.title} tokenId={room.id} indexing={indexing} usdPerBsv={usdPerBsv} userId={session?.userId ?? null} />}

      {room.kind === "bsv20" && (
        <p className="mb-4 rounded-lg border border-yellow-900/60 bg-yellow-950/30 px-3 py-2 text-sm text-yellow-200/80">
          BSV-20 (ticker) tokens are no longer supported by current 1Sat indexers, so balances for this room may be out of
          date and it isn&apos;t listed on the market. BSV-21 tokens and 1Sat collections are fully supported.
        </p>
      )}

      {!meta && (
        <p className="mb-4 rounded-lg border border-yellow-900/60 bg-yellow-950/30 px-3 py-2 text-sm text-yellow-200/80">
          The indexer doesn&apos;t recognise this token. Check the id.
        </p>
      )}

      {access.ok && session ? (
        <ChatRoom
          apiBase={`/api/rooms/${room.kind}/${encodeURIComponent(room.id)}/messages`}
          initial={await store.list(room.key, { limit: 100 })}
          me={session.userId}
        />
      ) : (
        <div className="flex flex-1 flex-col items-center rounded-2xl border border-line bg-panel px-6 py-12 text-center">
          <div className="mb-3 text-4xl">🔒</div>
          <h2 className="text-xl font-medium">Holders only</h2>
          <p className="mb-8 mt-2 max-w-md text-muted">
            {!session
              ? `Hold ${title} to join. Buy in below with Yours Wallet, or connect if you already hold it.`
              : access.error
                ? `We couldn't reach the indexer (${access.error}). Try again in a moment.`
                : session.wallet === "brc100"
                  ? `Hold ${title}? Prove it with one approval in Yours. Or buy in below and you'll be let straight in.`
                  : `None of your verified addresses hold ${title}. Buy in below and you'll be let straight in.`}
          </p>
          {session?.wallet === "brc100" && !access.error && (
            <div className="mb-8">
              <ProveHolding kind={room.kind} id={room.id} />
            </div>
          )}
          <BuyPanel
            kind={room.kind}
            roomId={room.id}
            title={title}
            {...await roomMarket(room)}
            marketUrl={marketUrl(room)}
            messagesApi={`/api/rooms/${room.kind}/${encodeURIComponent(room.id)}/messages`}
            signedIn={!!session}
            userId={session?.userId ?? null}
            usdPerBsv={usdPerBsv}
          />
          <div className="mt-8 flex items-center gap-3 text-sm">
            {!session ? (
              <ConnectPrompt label="I already hold it: connect" />
            ) : (
              <Link href="/market" className="rounded-full border border-line px-4 py-1.5">
                Browse the market
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
