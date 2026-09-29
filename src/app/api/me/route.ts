import { getSession } from "@/lib/session";
import { json } from "@/lib/http";

export async function GET() {
  const session = await getSession();
  if (!session) return json({ error: "Not signed in" }, 401);
  const diag =
    process.env.NODE_ENV !== "production"
      ? (globalThis as unknown as { __ssDiag?: Map<string, unknown> }).__ssDiag?.get(session.userId)
      : undefined;
  return json({ userId: session.userId, wallet: session.wallet, name: session.name, addresses: session.addresses, diag });
}
