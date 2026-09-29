import { challengeMessage, issueChallenge } from "@/lib/session";
import { json, sameOrigin } from "@/lib/http";

export async function POST(req: Request) {
  if (!sameOrigin(req)) return json({ error: "Bad origin" }, 403);
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "1satsocial";
  const c = await issueChallenge(host);
  return json({ message: challengeMessage(c) });
}
