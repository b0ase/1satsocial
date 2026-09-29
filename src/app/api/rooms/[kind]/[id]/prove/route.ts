import { PublicKey } from "@bsv/sdk";
import { verifyDer } from "@/lib/auth";
import { json, sameOrigin } from "@/lib/http";
import { verifyOutputs } from "@/lib/ownership";
import { parseRoom } from "@/lib/room-ref";
import { challengeMessage, getSession, setSession, takeChallenge } from "@/lib/session";
import { store } from "@/lib/store";

type Body = { outputs?: unknown; message?: unknown; pubKey?: unknown; sig?: unknown };

// POST /api/rooms/:kind/:id/prove — prove you hold this room's asset with one wallet signature.
//   { outputs }                       → which of these outpoints are this room's asset (no ownership check yet)
//   { outputs, message, pubKey, sig } → the key that locks them signed the challenge: store the verified holdings
export async function POST(req: Request, ctx: RouteContext<"/api/rooms/[kind]/[id]/prove">) {
  if (!sameOrigin(req)) return json({ error: "Bad origin" }, 403);
  const { kind, id } = await ctx.params;
  const room = parseRoom(kind, id);
  if (!room) return json({ error: "Unknown room" }, 404);
  const session = await getSession();
  if (!session) return json({ error: "Connect your wallet first" }, 401);

  const body = (await req.json().catch(() => ({}))) as Body;
  const outputs = Array.isArray(body.outputs) ? body.outputs.filter((o): o is string => typeof o === "string") : [];
  if (!outputs.length) return json({ error: "No outputs" }, 400);

  if (body.sig === undefined) {
    const matches = await verifyOutputs(null, outputs, room.key);
    return json({ outpoints: matches.map((m) => m.outpoint) });
  }

  const challenge = await takeChallenge();
  if (!challenge) return json({ error: "Challenge expired. Try again." }, 400);
  if (body.message !== challengeMessage(challenge) || typeof body.pubKey !== "string" || typeof body.sig !== "string") {
    return json({ error: "Bad proof" }, 400);
  }
  let address: string;
  try {
    const pub = PublicKey.fromString(body.pubKey);
    if (!verifyDer(pub, body.message, body.sig)) return json({ error: "Signature did not verify" }, 401);
    address = pub.toAddress();
  } catch {
    return json({ error: "Bad key" }, 400);
  }

  const rows = await verifyOutputs([address], outputs, room.key);
  if (!rows.length) return json({ error: "That key doesn't hold this room's asset on-chain." }, 422);
  await store.addHoldings(session.userId, rows);
  if (!session.addresses.includes(address)) {
    await setSession({ ...session, addresses: [...session.addresses, address].slice(-50) });
  }
  return json({ ok: true, holdings: rows.length });
}
