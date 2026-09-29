// End-to-end check of the sign-in + holder gate with scripted wallets (no browser extension needed).
// Usage: node scripts/e2e.mjs [baseUrl]
import { BSM, PrivateKey, ProtoWallet, Utils } from "@bsv/sdk";

const BASE = process.argv[2] ?? "http://127.0.0.1:3100";
const ROOM = "/api/rooms/bsv21/a54d3af24a03bcc28f6b3f2dd0ad249ee042b2f4b95810ae5184ab617a74b8b9_0/messages";
let pass = 0, fail = 0;
const check = (name, ok, extra = "") => { if (ok) pass++; else fail++; console.log(`${ok ? "PASS" : "FAIL"} ${name} ${extra}`); };

class Client {
  cookies = new Map();
  async req(path, init = {}) {
    const res = await fetch(BASE + path, {
      ...init,
      headers: { ...(init.headers ?? {}), cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; "), "content-type": "application/json" },
      redirect: "manual",
    });
    for (const c of res.headers.getSetCookie()) {
      const [kv] = c.split(";");
      const [k, v] = kv.split("=");
      if (v) this.cookies.set(k, v); else this.cookies.delete(k);
    }
    return res;
  }
  async challenge() { return (await (await this.req("/api/auth/challenge", { method: "POST" })).json()).message; }
  verify(proof) { return this.req("/api/auth/verify", { method: "POST", body: JSON.stringify(proof) }); }
}

// 1. BRC-100 wallet (what Yours v5 exposes), with one asset key
{
  const c = new Client();
  const wallet = new ProtoWallet(PrivateKey.fromRandom());
  const { publicKey: identityKey } = await wallet.getPublicKey({ identityKey: true });
  const message = await c.challenge();
  const data = Utils.toArray(message, "utf8");
  const { signature: idSig } = await wallet.createSignature({ data, protocolID: [0, "1satsocial login"], keyID: "1", counterparty: "anyone" });
  const d = { protocolID: [0, "onesat"], keyID: "1sat 0", counterparty: "self" };
  const { publicKey } = await wallet.getPublicKey({ ...d, forSelf: true });
  const { signature } = await wallet.createSignature({ ...d, data });
  const res = await c.verify({ kind: "brc100", message, identityKey, identitySig: Utils.toHex(idSig), keys: [{ pubKey: publicKey, sig: Utils.toHex(signature) }] });
  const body = await res.json();
  check("brc100 login", res.ok && body.addresses?.length === 1, JSON.stringify(body));
  const r = await c.req(ROOM);
  check("non-holder gets 403 on read", r.status === 403);
  const p = await c.req(ROOM, { method: "POST", body: JSON.stringify({ body: "gm" }) });
  check("non-holder gets 403 on post", p.status === 403);

  // Replay: reuse the same proof after the challenge was consumed
  const again = await c.verify({ kind: "brc100", message, identityKey, identitySig: Utils.toHex(idSig), keys: [] });
  check("challenge replay rejected", again.status === 400 || again.status === 401);
}

// 2. Forged identity: sign with a different key
{
  const c = new Client();
  const real = new ProtoWallet(PrivateKey.fromRandom());
  const attacker = new ProtoWallet(PrivateKey.fromRandom());
  const { publicKey: identityKey } = await real.getPublicKey({ identityKey: true });
  const message = await c.challenge();
  const { signature } = await attacker.createSignature({ data: Utils.toArray(message, "utf8"), protocolID: [0, "1satsocial login"], keyID: "1", counterparty: "anyone" });
  const res = await c.verify({ kind: "brc100", message, identityKey, identitySig: Utils.toHex(signature), keys: [] });
  check("forged identity rejected", res.status === 401);
}

// 3. Legacy window.yours: BSM with the ordinals key
{
  const c = new Client();
  const key = PrivateKey.fromRandom();
  const message = await c.challenge();
  const sig = BSM.sign(Utils.toArray(message, "utf8"), key, "base64");
  const res = await c.verify({ kind: "legacy", message, sig, pubKey: key.toPublicKey().toString(), address: key.toAddress(), name: "legacy<b>tester" });
  check("legacy BSM login", res.ok);

  // Claiming someone else's address with our signature must fail
  const c2 = new Client();
  const m2 = await c2.challenge();
  const sig2 = BSM.sign(Utils.toArray(m2, "utf8"), key, "base64");
  const bad = await c2.verify({ kind: "legacy", message: m2, sig: sig2, pubKey: key.toPublicKey().toString(), address: "17k4thtSCtLcmMnvTaTBTe8n2MtCqemtLQ" });
  check("legacy address spoof rejected", bad.status === 401);

  const lo = await c.req("/api/auth/logout", { method: "POST" });
  check("logout", lo.ok && !c.cookies.has("ss_session"));
}

// 4. Cross-origin POST blocked
{
  const c = new Client();
  const r = await c.req("/api/auth/challenge", { method: "POST", headers: { origin: "https://evil.example" } });
  check("cross-origin blocked", r.status === 403);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
