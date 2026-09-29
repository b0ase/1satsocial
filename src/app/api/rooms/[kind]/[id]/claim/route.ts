import { verifyPurchase } from "@/lib/claim";
import { json, sameOrigin } from "@/lib/http";
import { parseRoom } from "@/lib/room-ref";
import { getSession } from "@/lib/session";
import { store } from "@/lib/store";

// Provisional access lasts until the indexers see the purchase (normally the next block).
const GRANT_HOURS = 6;

// POST /api/rooms/:kind/:id/claim { txid } — instant access from a just-broadcast purchase.
export async function POST(req: Request, ctx: RouteContext<"/api/rooms/[kind]/[id]/claim">) {
  if (!sameOrigin(req)) return json({ error: "Bad origin" }, 403);
  const { kind, id } = await ctx.params;
  const room = parseRoom(kind, id);
  if (!room) return json({ error: "Unknown room" }, 404);
  const session = await getSession();
  if (!session) return json({ error: "Connect your wallet first" }, 401);

  const { txid } = (await req.json().catch(() => ({}))) as { txid?: unknown };
  if (typeof txid !== "string") return json({ error: "Missing txid" }, 400);

  const result = await verifyPurchase(room, txid.toLowerCase(), session);
  if (!result.ok) return json({ error: result.error }, 422);

  const granted = await store.addGrant({
    room: room.key,
    userId: session.userId,
    txid: txid.toLowerCase(),
    holding: result.holding,
    expiresAt: new Date(Date.now() + GRANT_HOURS * 3_600_000).toISOString(),
  });
  if (!granted) return json({ error: "This purchase has already been used to join this room." }, 409);
  return json({ ok: true, holding: result.holding });
}
