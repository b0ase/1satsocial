import { BSM, PublicKey, Signature, Utils } from "@bsv/sdk";

function parseSig(sig: string): Signature | null {
  // Yours returns a base64 BSM (compact, 65 byte) signature; accept DER too.
  const attempts: Array<() => Signature> = [
    () => Signature.fromCompact(sig, "base64"),
    () => Signature.fromDER(sig, "base64"),
    () => Signature.fromDER(sig, "hex"),
  ];
  for (const attempt of attempts) {
    try {
      return attempt();
    } catch {
      /* try next encoding */
    }
  }
  return null;
}

/** Verify a Bitcoin Signed Message and that pubKey hashes to address. */
export function verifySignedMessage(opts: {
  message: string;
  sig: string;
  pubKey: string;
  address: string;
}): boolean {
  try {
    const pub = PublicKey.fromString(opts.pubKey);
    if (pub.toAddress() !== opts.address) return false;
    const sig = parseSig(opts.sig);
    if (!sig) return false;
    return BSM.verify(Utils.toArray(opts.message, "utf8"), sig, pub);
  } catch {
    return false;
  }
}
