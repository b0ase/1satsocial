import { clearSession } from "@/lib/session";
import { json, sameOrigin } from "@/lib/http";

export async function POST(req: Request) {
  if (!sameOrigin(req)) return json({ error: "Bad origin" }, 403);
  await clearSession();
  return json({ ok: true });
}
