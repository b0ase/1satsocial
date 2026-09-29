import { collectionCount, fungibleBalances, formatAmount, heldCollections, roomMeta, type RoomMeta } from "./indexer";
import { parseRoom, type RoomRef } from "./room-ref";
import type { Session } from "./session";
import { store } from "./store";

export * from "./room-ref";

export type Access = { ok: boolean; holding: string | null; error?: string };

/** Does any of the session's proven addresses hold this room's token? */
export async function checkAccess(session: Session | null, room: RoomRef, meta?: RoomMeta | null): Promise<Access> {
  if (!session) return { ok: false, holding: null };
  const onChain = await checkHoldings(session, room, meta);
  if (onChain.ok) return onChain;
  // A verified purchase the indexers haven't caught up with yet (see /claim).
  const grant = await store.activeGrant(room.key, session.userId).catch(() => null);
  if (grant) return { ok: true, holding: `${grant.holding} · confirming` };
  return onChain;
}

async function checkHoldings(session: Session, room: RoomRef, meta?: RoomMeta | null): Promise<Access> {
  try {
    if (room.kind === "coll") {
      const counts = await Promise.all(session.addresses.map((a) => collectionCount(a, room.id)));
      const n = counts.reduce((a, b) => a + b, 0);
      return { ok: n > 0, holding: n > 0 ? `${n}${n >= 100 ? "+" : ""} item${n === 1 ? "" : "s"}` : null };
    }
    const balances = await Promise.all(session.addresses.map((a) => fungibleBalances(a)));
    let total = BigInt(0);
    let dec = meta?.dec ?? 0;
    for (const list of balances) {
      for (const h of list) {
        if (h.kind === room.kind && h.key.toLowerCase() === room.id.toLowerCase()) {
          total += h.amount;
          dec = h.dec;
        }
      }
    }
    return { ok: total > BigInt(0), holding: total > BigInt(0) ? formatAmount(total, dec) : null };
  } catch (e) {
    return { ok: false, holding: null, error: e instanceof Error ? e.message : "Indexer unavailable" };
  }
}

export type EligibleRoom = RoomRef & { title: string; image: string | null; holding: string };

/** Every room the session's addresses qualify for. */
export async function eligibleRooms(session: Session): Promise<EligibleRoom[]> {
  const out = new Map<string, EligibleRoom>();
  const [fungibles, colls] = await Promise.all([
    Promise.all(session.addresses.map((a) => fungibleBalances(a).catch(() => []))),
    Promise.all(session.addresses.map((a) => heldCollections(a).catch(() => new Map<string, number>()))),
  ]);
  for (const h of fungibles.flat()) {
    const ref = parseRoom(h.kind, h.key);
    if (!ref || out.has(ref.key)) continue;
    out.set(ref.key, {
      ...ref,
      title: `$${h.symbol.replace(/^\$/, "")}`,
      image: h.icon ? `${process.env.NEXT_PUBLIC_CONTENT_URL || "https://ordfs.network/content"}/${h.icon}` : null,
      holding: formatAmount(h.amount, h.dec),
    });
  }
  const collTotals = new Map<string, number>();
  for (const m of colls) for (const [id, n] of m) collTotals.set(id, (collTotals.get(id) ?? 0) + n);
  await Promise.all(
    [...collTotals].slice(0, 40).map(async ([id, n]) => {
      const ref = parseRoom("coll", id);
      if (!ref) return;
      const meta = await roomMeta("coll", ref.id);
      out.set(ref.key, { ...ref, title: meta?.title ?? `Collection ${id.slice(0, 8)}`, image: meta?.image ?? null, holding: `${n} item${n === 1 ? "" : "s"}` });
    }),
  );
  return [...out.values()];
}
