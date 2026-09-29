import { PrivateKey, PublicKey, Signature, Utils } from "@bsv/sdk";
import { verifySignedMessage } from "./bsm";
import { LOGIN_KEY_ID, LOGIN_PROTOCOL, MAX_PROOF_KEYS, type LoginProof } from "./login-shared";
import type { Session } from "./session";

function verifyDer(pub: PublicKey, message: string, sigHex: string): boolean {
  try {
    return pub.verify(Utils.toArray(message, "utf8"), Signature.fromDER(sigHex, "hex"));
  } catch {
    return false;
  }
}

function cleanName(name: unknown): string | null {
  if (typeof name !== "string") return null;
  const n = name.replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 32);
  return n || null;
}

/** Validate a login proof against the expected challenge message. Returns session data or an error. */
export function verifyLogin(proof: LoginProof, expectedMessage: string): Omit<Session, "exp"> | { error: string } {
  if (proof.message !== expectedMessage) return { error: "Challenge mismatch. Try again." };

  if (proof.kind === "legacy") {
    if (!verifySignedMessage(proof)) return { error: "Signature did not verify" };
    return { userId: proof.address, wallet: "legacy", addresses: [proof.address], name: cleanName(proof.name) };
  }

  if (proof.kind === "brc100") {
    let identity: PublicKey;
    try {
      identity = PublicKey.fromString(proof.identityKey);
    } catch {
      return { error: "Bad identity key" };
    }
    // BRC-42 "anyone" derivation: anyone can compute the child public key from the identity key.
    const invoice = `${LOGIN_PROTOCOL[0]}-${LOGIN_PROTOCOL[1]}-${LOGIN_KEY_ID}`;
    const signer = identity.deriveChild(new PrivateKey(1), invoice);
    if (!verifyDer(signer, proof.message, proof.identitySig)) return { error: "Identity signature did not verify" };

    const addresses = new Set<string>();
    for (const k of (proof.keys ?? []).slice(0, MAX_PROOF_KEYS)) {
      try {
        const pub = PublicKey.fromString(k.pubKey);
        if (verifyDer(pub, proof.message, k.sig)) addresses.add(pub.toAddress());
      } catch {
        /* skip malformed key */
      }
    }
    return { userId: proof.identityKey, wallet: "brc100", addresses: [...addresses], name: cleanName(proof.name) };
  }

  return { error: "Unknown wallet type" };
}
