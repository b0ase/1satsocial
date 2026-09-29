// Per-output ownership proofs. Instead of asking an indexer "what does this address hold?", the wallet names the
// outputs it holds and the server checks each one from chain data:
//   1. its locking script pays an address whose key the user just proved (signature at sign-in),
//   2. it is unspent (1Sat API),
//   3. it is the asset it claims to be: BSV-21 via the 1Sat overlay (GorillaPool as a labelled fallback for tokens
//      the overlay hasn't indexed), collection items via their origin inscription's MAP data (ORDFS).
import { Utils, type LockingScript } from "@bsv/sdk";
import { loadTx, p2pkhAddress } from "./claim";
import { MAX_PROOF_OUTPUTS } from "./login-shared";
import { parseRoom } from "./room-ref";

const ONESAT = process.env.ONESAT_API_URL || "https://api.1sat.app/1sat";
const GP = process.env.ORDINALS_API_URL || "https://ordinals.gorillapool.io/api";

export type HoldingSource = "overlay" | "gorillapool" | "ordfs";

export type Holding = {
  room: string; // room key, e.g. "bsv21:<id>" or "coll:<id>"
  outpoint: string; // txid_vout
  amount: string; // raw token units, or "1" for a collection item
  source: HoldingSource;
};

const get = (url: string) => fetch(url, { signal: AbortSignal.timeout(12_000), cache: "no-store" });

const g = globalThis as unknown as { __ssSpent?: Map<string, { spent: boolean; expires: number }> };
const spentCache = (g.__ssSpent ??= new Map());

/** Has this output been spent? Cached 60s so access re-checks are cheap. Unknown (API down) counts as unspent. */
export async function isSpent(outpoint: string): Promise<boolean> {
  const hit = spentCache.get(outpoint);
  if (hit && hit.expires > Date.now()) return hit.spent;
  let spent = false;
  try {
    const res = await get(`${ONESAT}/txo/${outpoint.replace("_", ".")}/spend`);
    if (res.ok) spent = !!((await res.json()) as { spendTxid?: string | null }).spendTxid;
  } catch {
    /* keep previous answer if we have one */
    if (hit) return hit.spent;
  }
  spentCache.set(outpoint, { spent, expires: Date.now() + 60_000 });
  return spent;
}

/** Spend status for many outputs in one request (1sat-stack POST /txo/spends). Fills the same 60s cache. */
export async function spentMany(outpoints: string[]): Promise<Map<string, boolean>> {
  const out = new Map<string, boolean>();
  const todo: string[] = [];
  for (const op of outpoints) {
    const hit = spentCache.get(op);
    if (hit && hit.expires > Date.now()) out.set(op, hit.spent);
    else todo.push(op);
  }
  for (let i = 0; i < todo.length; i += 100) {
    const batch = todo.slice(i, i + 100);
    try {
      const res = await fetch(`${ONESAT}/txo/spends`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(batch.map((o) => o.replace("_", "."))),
        signal: AbortSignal.timeout(12_000),
        cache: "no-store",
      });
      if (!res.ok) throw new Error(String(res.status));
      const rows = (await res.json()) as { spendTxid?: string | null }[];
      batch.forEach((op, k) => {
        const spent = !!rows[k]?.spendTxid;
        spentCache.set(op, { spent, expires: Date.now() + 60_000 });
        out.set(op, spent);
      });
    } catch {
      // Bulk route unavailable: fall back to one request per output.
      await mapLimit(batch, 6, async (op) => out.set(op, await isSpent(op)));
    }
  }
  return out;
}

/** BSV-21 inscription on an output: a transfer, or the deploy+mint output itself (whose id is its own outpoint). */
function bsv21Data(script: LockingScript, outpoint: string): { id: string; amt: bigint } | null {
  for (const chunk of script.chunks) {
    if (!chunk.data || chunk.data.length < 20 || chunk.data[0] !== 0x7b) continue; // '{'
    try {
      const j = JSON.parse(Utils.toUTF8(chunk.data)) as { p?: string; op?: string; id?: string; amt?: string };
      if (j.p !== "bsv-20" || !j.amt) continue;
      if (j.op === "transfer" && j.id) return { id: j.id, amt: BigInt(j.amt) };
      if (j.op === "deploy+mint") return { id: outpoint, amt: BigInt(j.amt) };
    } catch {
      /* not JSON */
    }
  }
  return null;
}

async function bsv21Valid(tokenId: string, outpoint: string): Promise<HoldingSource | null> {
  const overlay = await get(`${ONESAT}/bsv21/${tokenId}/outputs/${outpoint.replace("_", ".")}`).catch(() => null);
  if (overlay?.ok) return "overlay";
  // Not in the overlay (history never submitted there): accept GorillaPool's validation, labelled as such.
  const gp = await get(`${GP}/bsv20/outpoint/${outpoint}`).catch(() => null);
  if (!gp?.ok) return null;
  const d = (await gp.json().catch(() => null)) as { id?: string; status?: number } | null;
  return d?.id === tokenId && d.status === 1 ? "gorillapool" : null;
}

type OrdfsMeta = { map?: { subType?: string; subTypeData?: string | { collectionId?: string } }; origin?: string };

async function collectionOf(outpoint: string): Promise<string | null> {
  const res = await get(`${ONESAT}/ordfs/metadata/${outpoint.replace("_", ".")}:-2`).catch(() => null);
  if (!res?.ok) return null;
  const meta = (await res.json().catch(() => null)) as OrdfsMeta | null;
  if (meta?.map?.subType !== "collectionItem") return null;
  let std = meta.map.subTypeData;
  if (typeof std === "string") {
    try {
      std = JSON.parse(std) as { collectionId?: string };
    } catch {
      return null;
    }
  }
  return std?.collectionId ?? null;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

/** Verify the outputs a wallet says it holds. Returns only those proven owned by `addresses`, unspent, and valid. */
export async function verifyOutputs(addresses: string[], outpoints: string[]): Promise<Holding[]> {
  const owned = new Set(addresses);
  const unique = [...new Set(outpoints.map((o) => o.replace(".", "_")))]
    .filter((o) => /^[0-9a-f]{64}_\d{1,6}$/.test(o))
    .slice(0, MAX_PROOF_OUTPUTS);

  // One transaction fetch per txid.
  const txids = [...new Set(unique.map((o) => o.split("_")[0]))];
  const txs = new Map((await mapLimit(txids, 6, async (t) => [t, await loadTx(t)] as const)).filter(([, tx]) => tx));

  // Keep only outputs locked to a key the user proved, then check their spend status in one bulk request.
  const locked = unique.filter((outpoint) => {
    const [txid, v] = outpoint.split("_");
    const output = txs.get(txid)?.outputs[Number(v)];
    const addr = output ? p2pkhAddress(output.lockingScript) : null;
    return !!addr && owned.has(addr);
  });
  const spent = await spentMany(locked);

  const results = await mapLimit(locked, 6, async (outpoint): Promise<Holding | null> => {
    const [txid, v] = outpoint.split("_");
    const output = txs.get(txid)!.outputs[Number(v)];
    if (spent.get(outpoint)) return null;

    const token = bsv21Data(output.lockingScript, outpoint);
    if (token) {
      const room = parseRoom("bsv21", token.id);
      const source = room ? await bsv21Valid(token.id, outpoint) : null;
      return room && source ? { room: room.key, outpoint, amount: token.amt.toString(), source } : null;
    }
    if (output.satoshis === 1) {
      const collectionId = await collectionOf(outpoint);
      const room = collectionId ? parseRoom("coll", collectionId) : null;
      return room ? { room: room.key, outpoint, amount: "1", source: "ordfs" } : null;
    }
    return null;
  });
  return results.filter((h): h is Holding => !!h);
}
