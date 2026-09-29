import { json, sameOrigin } from "@/lib/http";
import { roomMeta } from "@/lib/indexer";
import { checkAccess, parseRoom } from "@/lib/rooms";
import { getSession } from "@/lib/session";
import { store } from "@/lib/store";

const MAX_LEN = 1000;
const lastPost = new Map<string, number>();

export async function GET(req: Request, ctx: RouteContext<"/api/rooms/[kind]/[id]/messages">) {
  const { kind, id } = await ctx.params;
  const room = parseRoom(kind, id);
  if (!room) return json({ error: "Unknown room" }, 404);
  const access = await checkAccess(await getSession(), room);
  if (!access.ok) return json({ error: "Holders only" }, 403);

  const afterParam = new URL(req.url).searchParams.get("after");
  const after = afterParam ? Number(afterParam) : undefined;
  const messages = await store.list(room.key, { after: Number.isFinite(after) ? after : undefined, limit: 200 });
  return json({ messages });
}

export async function POST(req: Request, ctx: RouteContext<"/api/rooms/[kind]/[id]/messages">) {
  if (!sameOrigin(req)) return json({ error: "Bad origin" }, 403);
  const { kind, id } = await ctx.params;
  const room = parseRoom(kind, id);
  if (!room) return json({ error: "Unknown room" }, 404);

  const session = await getSession();
  if (!session) return json({ error: "Connect your wallet first" }, 401);
  const access = await checkAccess(session, room, await roomMeta(room.kind, room.id));
  if (!access.ok) return json({ error: "Holders only. Access follows the token." }, 403);

  const now = Date.now();
  if (now - (lastPost.get(session.userId) ?? 0) < 1000) return json({ error: "Slow down" }, 429);
  lastPost.set(session.userId, now);

  const { body } = (await req.json().catch(() => ({}))) as { body?: unknown };
  const text = typeof body === "string" ? body.trim() : "";
  if (!text) return json({ error: "Empty message" }, 400);
  if (text.length > MAX_LEN) return json({ error: `Max ${MAX_LEN} characters` }, 400);

  const message = await store.add({ room: room.key, userId: session.userId, name: session.name, body: text });
  return json({ message });
}
