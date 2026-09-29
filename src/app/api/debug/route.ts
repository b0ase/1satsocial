// Dev-only: collects client-side diagnostics (e.g. what the buy flow sends to the wallet).
import { json } from "@/lib/http";

const g = globalThis as unknown as { __ssDebug?: unknown[] };

export async function POST(req: Request) {
  if (process.env.NODE_ENV === "production") return json({ error: "Not found" }, 404);
  (g.__ssDebug ??= []).push({ at: new Date().toISOString(), ...(await req.json().catch(() => ({}))) });
  g.__ssDebug = g.__ssDebug.slice(-20);
  return json({ ok: true });
}

export async function GET() {
  if (process.env.NODE_ENV === "production") return json({ error: "Not found" }, 404);
  return json(g.__ssDebug ?? []);
}
