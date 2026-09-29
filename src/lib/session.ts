import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

export const SESSION_COOKIE = "ss_session";
export const CHALLENGE_COOKIE = "ss_challenge";
const SESSION_TTL_S = 60 * 60 * 24 * 7;
export const CHALLENGE_TTL_S = 5 * 60;

export type Session = {
  /** Stable id: identity key (Yours v5 / BRC-100) or ordinals address (legacy provider). */
  userId: string;
  wallet: "brc100" | "legacy";
  /** Addresses the user proved they control by signing the login challenge. */
  addresses: string[];
  name: string | null;
  exp: number;
};

export type Challenge = { nonce: string; issuedAt: string; domain: string; exp: number };

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (s && s.length >= 32) return s;
  if (process.env.NODE_ENV === "production") {
    throw new Error("SESSION_SECRET must be set (32+ chars) in production");
  }
  // Dev only: random per process, sessions reset on restart. Kept on globalThis because
  // route handlers and pages load separate copies of this module in dev.
  const g = globalThis as unknown as { __ssDevSecret?: string };
  g.__ssDevSecret ??= randomBytes(32).toString("hex");
  return g.__ssDevSecret;
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

export function seal(data: object): string {
  const payload = Buffer.from(JSON.stringify(data)).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function unseal<T extends { exp: number }>(token: string | undefined): T | null {
  if (!token) return null;
  const [payload, mac] = token.split(".");
  if (!payload || !mac) return null;
  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString()) as T;
    return data.exp > Date.now() / 1000 ? data : null;
  } catch {
    return null;
  }
}

const cookieOpts = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
};

export async function getSession(): Promise<Session | null> {
  return unseal<Session>((await cookies()).get(SESSION_COOKIE)?.value);
}

export async function setSession(s: Omit<Session, "exp">) {
  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL_S;
  (await cookies()).set(SESSION_COOKIE, seal({ ...s, exp }), { ...cookieOpts, maxAge: SESSION_TTL_S });
}

export async function clearSession() {
  (await cookies()).delete(SESSION_COOKIE);
}

export async function issueChallenge(domain: string): Promise<Challenge> {
  const c: Challenge = {
    nonce: randomBytes(16).toString("hex"),
    issuedAt: new Date().toISOString(),
    domain,
    exp: Math.floor(Date.now() / 1000) + CHALLENGE_TTL_S,
  };
  (await cookies()).set(CHALLENGE_COOKIE, seal(c), { ...cookieOpts, maxAge: CHALLENGE_TTL_S });
  return c;
}

export async function takeChallenge(): Promise<Challenge | null> {
  const store = await cookies();
  const c = unseal<Challenge>(store.get(CHALLENGE_COOKIE)?.value);
  store.delete(CHALLENGE_COOKIE);
  return c;
}

export function challengeMessage(c: Challenge): string {
  return [
    `${c.domain} wants you to sign in to 1satsocial with your ordinals address.`,
    "",
    "This proves you hold the tokens in your wallet. It does not move any funds.",
    "",
    `Domain: ${c.domain}`,
    `Nonce: ${c.nonce}`,
    `Issued At: ${c.issuedAt}`,
  ].join("\n");
}
