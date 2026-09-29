# 1satsocial

**Live: https://1satsocial.vercel.app**

Holder-only group chats for 1Sat Ordinals on BSV. Every BSV-21 token, BSV-20 tick and 1Sat collection gets a room. Only wallets holding that token can read or post. Sign in with Yours Wallet.

## How it works

1. **Sign in.** The browser gets a one-time challenge (an HMAC-signed cookie, valid 5 minutes) and asks Yours to sign it.
   - **Yours v5+ (BRC-100)** via `@1sat/connect`. The wallet signs with its identity key (`[0,"1satsocial login"]`, counterparty `anyone`). The server derives the matching BRC-42 child key from the identity key. The app then lists the `1sat`, `bsv21` and `bsv20` baskets, reads each output's key derivation from `customInstructions`, and signs the challenge once per distinct key (max 30). The server trusts only addresses whose signatures verify.
   - **Legacy `window.yours`** (older installs). One BSM signature with the ordinals key (`tag: yours/ord`). That proves the ordinals address.
2. **Gate.** Each read and post re-checks holdings for the proven addresses against the GorillaPool indexer (cached 60s). Selling the token revokes access.
   - Fungible: `GET /api/bsv20/{address}/balance`
   - Collections: `GET /api/txos/address/{address}/unspent?q=base64({"map":{"subTypeData":{"collectionId":…}}})`
3. **Chat.** Messages are stored in Postgres (`ss_messages`, schema in `db/schema.sql`, created automatically). Clients poll every 2.5s. With no `DATABASE_URL`, an in-memory store is used for dev.

4. **Buy in.** Locked rooms list the cheapest live listings (GorillaPool orderbook; BSV-21 listings are pre-validated against the 1Sat overlay). **Buy & enter** runs `buyOrdinal` / `buyBsv21` from `@1sat/actions` in the user's wallet (or `purchaseOrdinal` / `purchaseBsv20` on legacy Yours), then re-proves holdings and opens the room. An optional operator fee is set with `NEXT_PUBLIC_MARKET_FEE_*`.
   Listings that GorillaPool validates but the 1Sat overlay never indexed (their history wasn't submitted there) get **Buy · chat only**. It runs the same SDK purchase, with the listing check done against GorillaPool via `/api/listings/verify`. The buyer is warned that Yours may not show those tokens until the overlay catches up. See `docs/upstream/overlay-missing-bsv21-history.md`.
5. **Indexing fund.** BSV-21 rooms show the token's 1Sat overlay fund (1,000 sats per indexed output) and let holders top it up with a plain BSV payment. The fee address is only shown when the overlay and GorillaPool agree on it.
6. **Market.** `/market` ranks rooms by recent 1sat.market trades plus chat activity, with floor, holders and a buy/enter action. The home page shows the top 12.

Rooms: `/r/bsv21/<txid_vout>`, `/r/bsv20/<TICK>`, `/r/coll/<collection origin outpoint>`.

## Deploy

Vercel project `b0ase/1satsocial`, auto-deployed from `main`. Postgres is Neon via the Vercel Marketplace (`DATABASE_URL`). `SESSION_SECRET` is set per environment in Vercel.

## Develop

```bash
cp .env.example .env.local   # set SESSION_SECRET (openssl rand -hex 32)
pnpm install
pnpm dev
node scripts/e2e.mjs http://localhost:3000   # auth + gate tests with scripted wallets
```

## Roadmap

- Real-time transport (SSE or Vercel WebSockets) instead of polling
- Optional "pin to chain": post a message as a signed BSocial/MAP inscription via the wallet
- Holder tiers (for example whale-only channels by balance threshold), room admins set by the token deployer's key
- Encrypted rooms: a room key wrapped per holder with BRC-2 encryption
- Mentions and notifications, image and ordinal embeds in messages

## License

MIT. See [LICENSE](LICENSE). Contributions welcome.
