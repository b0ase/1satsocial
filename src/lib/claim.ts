// Instant access after a purchase: verify the transaction ourselves instead of waiting for the next
// block and the indexers. Nothing here trusts the client beyond the txid it names.
import { Transaction, Utils, type LockingScript } from "@bsv/sdk";
import { formatAmount } from "./indexer";
import type { RoomRef } from "./room-ref";
import type { Session } from "./session";

const GP = process.env.ORDINALS_API_URL || "https://ordinals.gorillapool.io/api";
const ONESAT = process.env.ONESAT_API_URL || "https://api.1sat.app/1sat";

// Broadcast states that mean the network accepted the transaction (ARC status names).
const ACCEPTED = new Set(["SEEN_ON_NETWORK", "SEEN_MULTIPLE_NODES", "ACCEPTED_BY_NETWORK", "STORED", "ANNOUNCED_TO_NETWORK", "MINED", "IMMUTABLE"]);

const get = (url: string) => fetch(url, { signal: AbortSignal.timeout(15_000), cache: "no-store" });

async function networkAccepted(txid: string): Promise<boolean> {
  const arc = await get(`${ONESAT}/arcade/tx/${txid}`).catch(() => null);
  if (arc?.ok) {
    const { txStatus } = (await arc.json()) as { txStatus?: string };
    return !!txStatus && ACCEPTED.has(txStatus);
  }
  // Not broadcast through the 1Sat broadcaster: accept if JungleBus has seen it on the network.
  const jb = await get(`https://junglebus.gorillapool.io/v1/transaction/get/${txid}`).catch(() => null);
  return !!jb?.ok;
}

export async function loadTx(txid: string): Promise<Transaction | null> {
  for (const url of [`${ONESAT}/beef/${txid}/tx`, `https://junglebus.gorillapool.io/v1/transaction/get/${txid}/bin`]) {
    const res = await get(url).catch(() => null);
    if (!res?.ok) continue;
    try {
      const tx = Transaction.fromBinary(Array.from(new Uint8Array(await res.arrayBuffer())));
      if (tx.id("hex") === txid) return tx;
    } catch {
      /* try the next source */
    }
  }
  return null;
}

export function p2pkhAddress(script: LockingScript): string | null {
  const c = script.chunks;
  for (let i = 0; i + 4 < c.length; i++) {
    if (c[i].op === 0x76 && c[i + 1].op === 0xa9 && c[i + 2].data?.length === 20 && c[i + 3].op === 0x88 && c[i + 4].op === 0xac) {
      return Utils.toBase58Check(c[i + 2].data!);
    }
  }
  return null;
}

/** BSV-21 transfer inscription on an output, if any. */
function bsv21Transfer(script: LockingScript): { id: string; amt: bigint } | null {
  for (const chunk of script.chunks) {
    if (!chunk.data || chunk.data.length < 20 || chunk.data[0] !== 0x7b) continue; // '{'
    try {
      const j = JSON.parse(Utils.toUTF8(chunk.data)) as { p?: string; op?: string; id?: string; amt?: string };
      if (j.p === "bsv-20" && j.op === "transfer" && j.id && j.amt) return { id: j.id, amt: BigInt(j.amt) };
    } catch {
      /* not JSON */
    }
  }
  return null;
}

export type ClaimResult = { ok: true; holding: string } | { ok: false; error: string };

export async function verifyPurchase(room: RoomRef, txid: string, session: Session): Promise<ClaimResult> {
  if (!/^[0-9a-f]{64}$/.test(txid)) return { ok: false, error: "Bad transaction id" };
  if (!(await networkAccepted(txid))) return { ok: false, error: "The network hasn't accepted this transaction (yet)." };
  const tx = await loadTx(txid);
  if (!tx) return { ok: false, error: "Couldn't load the transaction" };
  const mine = new Set(session.addresses);

  if (room.kind === "bsv21") {
    // Tokens delivered to one of your proven addresses...
    let received = BigInt(0);
    for (const o of tx.outputs) {
      const t = bsv21Transfer(o.lockingScript);
      const addr = p2pkhAddress(o.lockingScript);
      if (t?.id === room.id && addr && mine.has(addr)) received += t.amt;
    }
    if (received === BigInt(0)) return { ok: false, error: "This transaction doesn't deliver this token to your wallet." };

    // ...funded by genuine token inputs of the same id (BSV-21 can't create tokens in a transfer).
    let spent = BigInt(0);
    let dec = 0;
    for (const i of tx.inputs) {
      const res = await get(`${GP}/bsv20/outpoint/${i.sourceTXID}_${i.sourceOutputIndex}`).catch(() => null);
      if (!res?.ok) continue;
      const d = (await res.json()) as { id?: string; status?: number; amt?: string; dec?: number };
      if (d.id === room.id && d.status === 1 && d.amt) {
        spent += BigInt(d.amt);
        dec = d.dec ?? dec;
      }
    }
    if (spent < received) return { ok: false, error: "The token inputs don't cover what was delivered." };
    return { ok: true, holding: formatAmount(received, dec) };
  }

  if (room.kind === "coll") {
    // A 1-sat ordinal moves to the output at its input's index in a 1Sat purchase.
    for (let k = 0; k < tx.inputs.length; k++) {
      const i = tx.inputs[k];
      const res = await get(`${GP}/txos/${i.sourceTXID}_${i.sourceOutputIndex}`).catch(() => null);
      if (!res?.ok) continue;
      const d = (await res.json()) as { origin?: { data?: { map?: { subTypeData?: { collectionId?: string } } } } };
      if (d.origin?.data?.map?.subTypeData?.collectionId !== room.id) continue;
      const out = tx.outputs[k];
      const addr = out && out.satoshis === 1 ? p2pkhAddress(out.lockingScript) : null;
      if (addr && mine.has(addr)) return { ok: true, holding: "1 item" };
    }
    return { ok: false, error: "This transaction doesn't deliver an item from this collection to your wallet." };
  }

  return { ok: false, error: "Instant access isn't available for this kind of room" };
}
