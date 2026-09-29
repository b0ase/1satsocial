// Shared between browser and server: the BRC-100 protocol used for the identity proof.
export const LOGIN_PROTOCOL: [0, string] = [0, "1satsocial login"];
export const LOGIN_KEY_ID = "1";
export const MAX_PROOF_KEYS = 30;

export type LegacyProof = {
  kind: "legacy";
  message: string;
  sig: string;
  pubKey: string;
  address: string;
  name?: string;
};

export type Brc100Proof = {
  kind: "brc100";
  message: string;
  identityKey: string;
  identitySig: string; // hex DER, counterparty "anyone"
  keys: { pubKey: string; sig: string }[]; // hex DER signatures by each asset-holding key
  name?: string;
  diag?: Record<string, unknown>; // dev-only sign-in diagnostics
};

export type LoginProof = LegacyProof | Brc100Proof;
