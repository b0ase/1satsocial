# What 1satsocial still needs from 1sat-stack

> For David (b-open-io). 1satsocial now uses only `api.1sat.app` (GorillaPool and JungleBus removed, 29 Sep 2026).
> These are the features that lost data in the switch, with the endpoint shape that would restore each one.

## 1. Market listings filtered by collection

A collection room shows its cheapest listings and floor price. `/market/listings` supports `status`, `type`, `q`
(name prefix), `from` and `rev`, but it can't filter by collection. So collection rooms currently show no listings
and link out to 1sat.market.

- Ask: `GET /market/listings?collection=<collectionId>&sort=price` (or an `origin` → collection join), cheapest
  first.
- Also useful: `map:collectionId:<id>` search events on listing outputs, not only on the mint output.

## 2. Market history (`/market/listings` backfill)

We use `/market/listings?status=active` (new listings) and `?status=sale` (sales) for the landing ticker and
trending. Today they return 0 active and 5 sales, so the landing page is nearly empty until the backfill lands. We
understand it's coming and are relying on the current shape.

## 3. Which collections an address holds

Legacy (pre-v5) Yours sign-ins prove one ordinals address. To gate a collection room for them we need to know
whether that address holds any item of the collection.

- Ask: `GET /owner/{address}/collections` (counts per collectionId), or `txo/search?key=own:<addr>` that works
  without a prior `/owner/sync`. Today it returns `null` for an unsynced address, e.g. a large $BLASTER holder.
- Yours v5 users are unaffected: they prove individual outputs.

## 4. Holder counts

The room header and market table showed "N holders". `/bsv21/{id}` gives `output_count` but not a holder count.

- Ask: `holders` (distinct owners with a balance) on `/bsv21/{id}`, and a holder count for collections if feasible.

## 5. BSV-21 listings missing from the overlay topic

Already in `overlay-missing-bsv21-history.md`. For $BLASTER, 9 of the 100 newest listings returned by
`txo/search?key=bsv21:<id>&key=ordlock&join=intersect` are in the overlay topic
(`POST /bsv21/{id}/outputs`). The other 91 can't be bought with `buyBsv21`, so we link them out to 1sat.market.
