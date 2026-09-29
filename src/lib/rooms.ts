import { bsv21Balance, formatAmount, roomMeta, type RoomMeta } from "./indexer";
import { spentMany } from "./ownership";
import { roomFromKey, type RoomRef } from "./room-ref";
import type { Session } from "./session";
import { store } from "./store";

export * from "./room-ref";

export type Access = { ok: boolean; holding: string | null; error?: string };

/**
 * The user's proven holdings, grouped by room. Spend status is only checked when `room` is given (entering that
 * room): listing rooms uses the stored proofs as-is, so a page load doesn't hit the API once per output.
 */
async function provenHoldings(session: Session, room?: string): Promise<Map<string, bigint>> {
  const all = await store.holdingsFor(session.userId).catch(() => []);
  const rows = room ? all.filter((r) => r.room === room) : all;
  const spent = room ? await spentMany(rows.map((r) => r.outpoint)) : new Map<string, boolean>();
  const live = rows.filter((r) => !spent.get(r.outpoint));
  const byRoom = new Map<string, bigint>();
  for (const r of live) if (r) byRoom.set(r.room, (byRoom.get(r.room) ?? BigInt(0)) + BigInt(r.amount));
  return byRoom;
}

function holdingLabel(room: RoomRef, amount: bigint, dec: number) {
  return room.kind === "coll" ? `${amount} item${amount === BigInt(1) ? "" : "s"}` : formatAmount(amount, dec);
}

export async function checkAccess(session: Session | null, room: RoomRef, meta?: RoomMeta | null): Promise<Access> {
  if (!session) return { ok: false, holding: null };
  // 1. Outputs the user proved they own, re-checked for spends (selling the token ends access).
  const proven = (await provenHoldings(session, room.key)).get(room.key);
  if (proven) return { ok: true, holding: holdingLabel(room, proven, (meta ?? (await roomMeta(room.kind, room.id)))?.dec ?? 0) };
  // 2. Token balance at the proven addresses (overlay): covers legacy-provider sign-ins and outputs not yet proved.
  const onChain = await checkHoldings(session, room, meta);
  if (onChain.ok) return onChain;
  // A verified purchase the indexers haven't caught up with yet (see /claim).
  const grant = await store.activeGrant(room.key, session.userId).catch(() => null);
  if (grant) return { ok: true, holding: `${grant.holding} · confirming` };
  return onChain;
}

/** Balance at the session's proven addresses, from the overlay. Collections have no by-address lookup yet. */
async function checkHoldings(session: Session, room: RoomRef, meta?: RoomMeta | null): Promise<Access> {
  if (room.kind !== "bsv21") return { ok: false, holding: null };
  try {
    const total = await bsv21Balance(room.id, session.addresses);
    const dec = (meta ?? (await roomMeta(room.kind, room.id)))?.dec ?? 0;
    return { ok: total > BigInt(0), holding: total > BigInt(0) ? formatAmount(total, dec) : null };
  } catch (e) {
    return { ok: false, holding: null, error: e instanceof Error ? e.message : "Indexer unavailable" };
  }
}

export type EligibleRoom = RoomRef & {
  title: string;
  image: string | null;
  holding: string;
  /** Access from a verified purchase the indexers haven't confirmed yet. */
  confirming?: boolean;
};

/** Every room the session's addresses qualify for. */
export async function eligibleRooms(session: Session): Promise<EligibleRoom[]> {
  const out = new Map<string, EligibleRoom>();
  // Proven holdings, then provisional grants from just-verified purchases.
  const proven = await provenHoldings(session);
  await Promise.all(
    [...proven].map(async ([key, amount]) => {
      const ref = roomFromKey(key);
      if (!ref) return;
      const meta = await roomMeta(ref.kind, ref.id);
      out.set(ref.key, {
        ...ref,
        title: meta?.title ?? ref.id.slice(0, 12),
        image: meta?.image ?? null,
        holding: holdingLabel(ref, amount, meta?.dec ?? 0),
      });
    }),
  );
  // Rooms unlocked by a just-verified purchase (instant access) that the indexers haven't caught up with.
  const grants = await store.activeGrantsFor(session.userId).catch(() => []);
  await Promise.all(
    grants.map(async (g) => {
      const ref = roomFromKey(g.room);
      if (!ref || out.has(ref.key)) return;
      const meta = await roomMeta(ref.kind, ref.id);
      out.set(ref.key, {
        ...ref,
        title: meta?.title ?? ref.id.slice(0, 12),
        image: meta?.image ?? null,
        holding: g.holding,
        confirming: true,
      });
    }),
  );
  return [...out.values()];
}
