# Draft issue for HandCash (BRC-100 wallet, beta)

> Sent to Brandon (HandCash) on Discord, who asked us to "submit an issue and I'll correct it soon". If he'd rather
> track it on GitHub: https://github.com/HandCash/HANDCASH-DESKTOP/issues

**Title:** How should a third-party app prove a user controls a 1Sat item / BSV-21 output held in the HandCash BRC-100 wallet?

## Context

[1satsocial](https://1satsocial.online) ([source](https://github.com/b0ase/1satsocial)) gives every BSV-21 token and 1Sat collection a holder-only chat room. It proves someone holds an item without trusting an address index:

1. **Sign-in:** the wallet signs a challenge with the identity key (one approval).
2. **Opening a room:** the app lists the wallet's outputs (`listOutputs`), and the server works out which ones belong to that room.
3. **Proof:** the wallet signs a challenge with the key that locks that output (`getPublicKey({ protocolID, keyID, counterparty, forSelf: true })` + `createSignature`, one approval). The server then checks the output on-chain: locked to that key, unspent, and a valid asset (1Sat overlay for BSV-21, ORDFS origin plus a matching Sigma signature for collection items).

With Yours Wallet this works because each output's `customInstructions` includes the key derivation (`{ protocolID, keyID, counterparty }`).

## What we see with HandCash (beta)

- The inventory is only reachable through the scoped baskets `p 1sat all` / `p bsv21 all`. The plain `1sat` / `bsv21` return `USE_PBSV21_SCOPE`. The app handles that now.
- `customInstructions` describe the asset (bsv-20 JSON, item origin, collection, creator, BRC-150 provenance) but not how the locking key was derived. So the app can't ask the wallet to sign with that key, and HandCash users can't prove they hold anything.

## Question / request

What's the intended way for an app to prove control of an output? Any one of these would work:

1. Add the locking key's derivation (`protocolID`, `keyID`, `counterparty`) to `customInstructions`, or expose the locking public key.
2. A wallet method that signs an app's challenge with the key that locks a given outpoint, after the user approves.
3. If BRC-150 provenance already proves the user's identity currently controls the output, docs on how a server should verify it against a fresh challenge, so a proof can't be replayed.

Happy to test against the beta. Relevant code: [`src/lib/wallet-client.ts`](https://github.com/b0ase/1satsocial/blob/main/src/lib/wallet-client.ts) (listing and signing) and [`src/lib/ownership.ts`](https://github.com/b0ase/1satsocial/blob/main/src/lib/ownership.ts) (server checks).
