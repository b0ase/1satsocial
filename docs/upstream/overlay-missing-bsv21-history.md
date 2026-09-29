# Draft issue for b-open-io/1sat-stack

> Not filed yet. Target: https://github.com/b-open-io/1sat-stack/issues (related: #56, unproven content never backfilled).

**Title:** BSV-21 overlay is missing valid token history that GorillaPool indexes, so listings can't be bought via `buyBsv21`

## Summary

The BSV-21 overlay only indexes transactions submitted to it. When a wallet or bot broadcasts BSV-21 transfers without submitting them to the overlay, the overlay never learns about that history. GorillaPool indexes the same outputs as valid, but anything downstream of them is invisible to the overlay. That includes marketplace listings. `buyBsv21` then refuses those listings with `listing-not-found-in-overlay`, and Yours v5 (which relies on the overlay) can't see the tokens.

This hits active, funded tokens too. It isn't a funding problem.

## Reproduction (29 Sep 2026, chain height ~968,900)

Token `$BLASTER`: `429bf19906897c0444a53bdf236473b1b3965a95a03f20863de640f49241d929_0`

- Overlay status: `is_active: true`, `balance: 2376000`, `fee_per_output: 1000`
- Listing outpoint `c22c7196fb91fcac1406ae06441f69202f96cffc4ab27aadbee7750f4a19c62e_0` (1.78 BLASTER for 30,000 sats)

| Check | Result |
|---|---|
| `GET ordinals.gorillapool.io/api/bsv20/outpoint/c22c71…_0` | `status: 1`, `listing: true`, unspent, height 968691 |
| `GET api.1sat.app/1sat/bsv21/{id}/outputs/c22c71….0` | `404 Outpoint not found in topic` |
| Its three token inputs (`1018131b…`, `9830d4f7…`, `ed16a624…`) on the overlay | all `404` (GorillaPool: valid transfers, heights 968404 to 968691) |
| `overlay.submitBsv21(listingBeef, tokenId)` | `Unable to process submitted transaction … due to an internal error` |
| Walking back through token inputs until reaching overlay-known outputs | **60+ missing transactions** (stopped counting at 60); 23 branches reach known outputs |

Of the cheapest ~80 listings for this token on GorillaPool, most are in this state. Similar gaps show up on other tokens (e.g. `$DOTI`, where the overlay has `is_active: false`).

## Impact

- `buyBsv21` fails with `listing-not-found-in-overlay` for these listings, including on 1sat.market.
- Buyers can't see or move such tokens in Yours v5 even though they're valid on-chain.
- Apps building on the SDK have to either send users elsewhere or bypass the overlay check.

## Suggested fixes

1. Backfill active topics from chain data (or from GorillaPool, which already validates these outputs) rather than relying only on submissions.
2. Or accept ancestry submissions: let a client submit a BEEF containing the missing chain back to known outputs, and admit it in one go. At the moment, submitting just the tip fails with an internal error rather than a clear "missing inputs" response.
3. Return a specific error (e.g. `missing-ancestor <outpoint>`) instead of an internal error, so clients can backfill.

## Smaller, related: misleading wallet error for `txid_vout` inputs

Passing an input outpoint as `txid_vout` (the GorillaPool format) to `buyBsv21` / `buyOrdinal` makes Yours 5.1 fail with:

```
The inputBEEF parameter must be valid and contain proof data for possibly known <txid>_0,
beef BEEF with 0 BUMPS and 0 Transactions, isValid true
```

`inputBEEF` was valid (1 tx, 1 BUMP). The real problem is the separator. `parseOutpoint` in `@1sat/utils` accepts both `.` and `_`, but the input is forwarded to `createAction` unchanged. Normalising to `txid.vout` in the actions (or in the wallet) would avoid this.

---

Found while building 1satsocial (https://github.com/b0ase/1satsocial). Happy to test fixes.
