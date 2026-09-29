import { verifyLogin } from "@/lib/auth";
import { json, sameOrigin } from "@/lib/http";
import type { LoginProof } from "@/lib/login-shared";
import { verifyOutputs } from "@/lib/ownership";
import { challengeMessage, setSession, takeChallenge } from "@/lib/session";
import { store } from "@/lib/store";

export async function POST(req: Request) {
  if (!sameOrigin(req)) return json({ error: "Bad origin" }, 403);
  const challenge = await takeChallenge();
  if (!challenge) return json({ error: "Challenge expired. Try again." }, 400);

  let proof: LoginProof;
  try {
    proof = await req.json();
  } catch {
    return json({ error: "Bad request" }, 400);
  }

  const result = verifyLogin(proof, challengeMessage(challenge));
  if ("error" in result) return json({ error: result.error }, 401);

  if (process.env.NODE_ENV !== "production" && proof.kind === "brc100" && proof.diag) {
    const g = globalThis as unknown as { __ssDiag?: Map<string, unknown> };
    (g.__ssDiag ??= new Map()).set(result.userId, { at: new Date().toISOString(), ...proof.diag });
  }

  // Per-output ownership proofs: keep only outputs locked to a proven key, unspent, and a valid asset.
  let holdings = 0;
  if (proof.kind === "brc100" && Array.isArray(proof.outputs)) {
    const rows = await verifyOutputs(result.addresses, proof.outputs.filter((o): o is string => typeof o === "string"));
    await store.replaceHoldings(result.userId, rows);
    holdings = rows.length;
  }

  await setSession(result);
  return json({ ok: true, userId: result.userId, addresses: result.addresses, holdings });
}
