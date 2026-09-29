// Raw chain reads shared by purchase verification (claim.ts) and ownership proofs (ownership.ts).
import { Transaction, Utils, type LockingScript } from "@bsv/sdk";

const ONESAT = process.env.ONESAT_API_URL || "https://api.1sat.app/1sat";

const get = (url: string) => fetch(url, { signal: AbortSignal.timeout(15_000), cache: "no-store" });

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
