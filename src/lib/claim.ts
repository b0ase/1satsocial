// Instant access after a purchase: verify the transaction ourselves instead of waiting for the next
// block and the indexers. Nothing here trusts the client beyond the txid it names.
import { loadTx, p2pkhAddress } from "./chain";
import { formatAmount, roomMeta } from "./indexer";
import { bsv21Data, bsv21Valid, collectionMember } from "./ownership";
import type { RoomRef } from "./room-ref";
import type { Session } from "./session";

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
  // Not broadcast through the 1Sat broadcaster: accept if 1sat-stack already has the transaction.
  const beef = await get(`${ONESAT}/beef/${txid}/tx`).catch(() => null);
  return !!beef?.ok;
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
    for (const [n, o] of tx.outputs.entries()) {
      const t = bsv21Data(o.lockingScript, `${txid}_${n}`);
      const addr = p2pkhAddress(o.lockingScript);
      if (t?.id === room.id && addr && mine.has(addr)) received += t.amt;
    }
    if (received === BigInt(0)) return { ok: false, error: "This transaction doesn't deliver this token to your wallet." };

    // ...funded by genuine token inputs of the same id (BSV-21 can't create tokens in a transfer). Each input is read
    // from its source transaction and validated against the 1Sat overlay (same check as sign-in).
    let spent = BigInt(0);
    for (const i of tx.inputs) {
      if (!i.sourceTXID) continue;
      const outpoint = `${i.sourceTXID}_${i.sourceOutputIndex}`;
      const src = await loadTx(i.sourceTXID);
      const out = src?.outputs[i.sourceOutputIndex];
      const token = out ? bsv21Data(out.lockingScript, outpoint) : null;
      if (token?.id === room.id && (await bsv21Valid(room.id, outpoint))) spent += token.amt;
    }
    if (spent < received) return { ok: false, error: "The token inputs don't cover what was delivered." };
    const dec = (await roomMeta(room.kind, room.id))?.dec ?? 0;
    return { ok: true, holding: formatAmount(received, dec) };
  }

  if (room.kind === "coll") {
    // A 1-sat ordinal moves to the output at its input's index in a 1Sat purchase.
    for (let k = 0; k < tx.inputs.length; k++) {
      const i = tx.inputs[k];
      if (!i.sourceTXID) continue;
      const member = await collectionMember(`${i.sourceTXID}_${i.sourceOutputIndex}`);
      if (member?.collectionId.replace(".", "_") !== room.id.replace(".", "_")) continue;
      const out = tx.outputs[k];
      const addr = out && out.satoshis === 1 ? p2pkhAddress(out.lockingScript) : null;
      if (addr && mine.has(addr)) return { ok: true, holding: "1 item" };
    }
    return { ok: false, error: "This transaction doesn't deliver an item from this collection to your wallet." };
  }

  return { ok: false, error: "Instant access isn't available for this kind of room" };
}
