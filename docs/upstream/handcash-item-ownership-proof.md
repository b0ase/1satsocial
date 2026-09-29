# Draft issue for HandCash (BRC-100 wallet, beta)

> Not filed yet. Requested by Brandon (HandCash): "submit an issue and I'll correct it soon".

**Title:** How should a third-party app prove a user controls a 1Sat item / BSV-21 output held in the HandCash BRC-100 wallet?

## Context

[1satsocial](https://1satsocial.online) ([source](https://github.com/b0ase/1satsocial)) gives every BSV-21 token and 1Sat collection a holder-only chat room. Sign-in proves ownership per output, without trusting an address index:

1. The app lists the wallet's item and token outputs (`listOutputs`).
2. For each distinct key that locks those outputs, the wallet signs the login challenge (`getPublicKey({ protocolID, keyID, counterparty, forSelf: true })` + `createSignature`).
3. The server checks each output from chain data: locked to one of those proven keys, unspent, and a valid asset (1Sat overlay for BSV-21, ORDFS origin for collection items).

With Yours Wallet this works because each output's `customInstructions` carries its key derivation (`{ protocolID, keyID, counterparty }`).

## What we see with HandCash (beta)

- Inventory is only exposed through the scoped baskets `p 1sat all` / `p bsv21 all` (plain `1sat` / `bsv21` return `USE_PBSV21_SCOPE`). The app now tries the scoped names as well.
- `customInstructions` describe the asset (bsv-20 JSON; item origin, collection, creator, BRC-150 provenance) but not the derivation of the key that locks the output. So the app can't ask the wallet to sign with that key, and the server can't tie the output to the signed-in user.

## Question / request

What's the intended way for an app to prove control of a listed output? Any of these would work for us:

1. Include the locking key's derivation (`protocolID`, `keyID`, `counterparty`) in `customInstructions`, or expose the locking public key.
2. A wallet method that signs an app-supplied challenge with the key that locks a given outpoint (after user approval).
3. If the BRC-150 provenance proof already proves current control by the user's identity, documentation on how a server should verify it against a challenge, to prevent replay.

Happy to test against the beta. Relevant code: `src/lib/wallet-client.ts` (listing and proving), `src/lib/ownership.ts` (server verification).
