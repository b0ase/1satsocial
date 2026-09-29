import { collectionCount, fungibleBalances, formatAmount, heldCollections, roomMeta, type RoomMeta } from "./indexer";
import { artUrl } from "./content";
import { spentMany } from "./ownership";
import { parseRoom, roomFromKey, type RoomRef } from "./room-ref";
import type { Session } from "./session";
import { store } from "./store";

export * from "./room-ref";

export type Access = { ok: boolean; holding: string | null; error?: string };

/** The user's proven holdings (per-output proofs from sign-in) that are still unspent, grouped by room. */
async function provenHoldings(session: Session): Promise<Map<string, bigint>> {
  const rows = await store.holdingsFor(session.userId).catch(() => []);
  const spent = await spentMany(rows.map((r) => r.outpoint));
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
  const proven = (await provenHoldings(session)).get(room.key);
  if (proven) return { ok: true, holding: holdingLabel(room, proven, (meta ?? (await roomMeta(room.kind, room.id)))?.dec ?? 0) };
  // 2. Legacy fallback: GorillaPool's address index (also covers older wallets without per-output proofs).
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
  // Proven holdings first (authoritative), then the legacy address index, then provisional grants.
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
      image: artUrl(h.icon),
      holding: formatAmount(h.amount, h.dec),
    });
  }
  const collTotals = new Map<string, number>();
  for (const m of colls) for (const [id, n] of m) collTotals.set(id, (collTotals.get(id) ?? 0) + n);
  await Promise.all(
    [...collTotals].slice(0, 40).map(async ([id, n]) => {
      const ref = parseRoom("coll", id);
      if (!ref || out.has(ref.key)) return; // proven holdings win
      const meta = await roomMeta("coll", ref.id);
      out.set(ref.key, { ...ref, title: meta?.title ?? `Collection ${id.slice(0, 8)}`, image: meta?.image ?? null, holding: `${n} item${n === 1 ? "" : "s"}` });
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
