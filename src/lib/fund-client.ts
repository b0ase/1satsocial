"use client";

// Paying into a BSV-21 token's 1Sat overlay indexing fund: a plain BSV payment to its fee address.
import { connectBrc100 } from "./wallet-connection";
import { P2PKH } from "@bsv/sdk";

export async function fundIndexing(feeAddress: string, satoshis: number, symbol: string): Promise<string> {
  if (!Number.isInteger(satoshis) || satoshis < 1000) throw new Error("Minimum is 1,000 sats");

  const conn = await connectBrc100().catch(() => null);
  if (conn) {
    const result = await conn.wallet.createAction({
      description: `Fund 1Sat indexing for ${symbol}`,
      outputs: [
        {
          lockingScript: new P2PKH().lock(feeAddress).toHex(),
          satoshis,
          outputDescription: "1Sat overlay indexing fund",
        },
      ],
      labels: ["1satsocial", "indexing-fund"],
    });
    if (!result.txid) throw new Error("Payment was not completed");
    return result.txid;
  }

  const yours = window.yours;
  if (yours?.isReady) {
    await yours.connect();
    const res = await yours.sendBsv([{ address: feeAddress, satoshis }]);
    if (!res?.txid) throw new Error("Payment was not completed");
    return res.txid;
  }

  throw new Error("Yours Wallet not detected.");
}
