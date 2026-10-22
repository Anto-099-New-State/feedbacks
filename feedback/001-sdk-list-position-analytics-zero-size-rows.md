# `listPerpPositionAnalytics` returns zero-size "priceable" rows for pools where the account only has resting orders

Severity: normal
Area: SDK

## Summary

`client.listPerpPositionAnalytics` is documented as "every position the account holds, each marked — the positions-table read". It builds one row per entry in the MarginBank's `getAccountState().activePerpPools`. That list contains pools where the account has a position **or resting orders**. The SDK says so itself in two places, but this function never drops `size === 0n` rows. An account with one position and one resting order in another market gets two rows, one of which is `priceable: true` with `size 0`, `notional 0`, `unrealizedPnl 0` and `returnOnMarginBps null`. A positions table built on it shows a flat "position" in every market where the trader merely has an order resting.

The `MarginAccount.activePerpPools` type doc ("Perp pools where the account holds an open position") states the opposite of the SDK's own implementation notes. That is likely how the filter got missed.

## Steps to reproduce

**Offline (deterministic, no network):**
1. `npm install`
2. `node repro/01-list-position-analytics-phantom-rows.mjs`

The script runs the SDK's real `listPerpPositionAnalytics` (the function `client.listPerpPositionAnalytics` delegates to, `src/createClient.ts:1379`) against a mock MarginBank that returns `activePerpPools: [BTC, ETH]`, with a position in BTC and only a resting order in ETH.

**Live (read-only):**
1. `npx tsx live/collect-evidence.mts`
2. Section `[01]` collects owners of resting orders across every perp pool and counts accounts that get zero-size priceable rows. Output goes to `evidence/01-phantom-rows.json`.

## Expected

One row per open position, the same set `fetchPositions` and the account view return. The SDK's own account view applies exactly this filter:

```ts
// src/accountView/positionsRead.ts:423-424
// `activePerpPools` also lists pools where the account only has resting orders.
if (position.size === 0n) continue;
```

## Actual

```
rows returned: 2 (account holds 1 position)
  {"pool":"0x…0B7C","priceable":true,"size":"10000000000000000","notional":"820000000000000000000","unrealizedPnl":"20000000000000000000","returnOnMarginBps":"4878"}
  {"pool":"0x…E7400","priceable":true,"size":"0","notional":"0","unrealizedPnl":"0","returnOnMarginBps":null}
BUG: 1 row(s) with priceable=true and size=0 — an order-only pool rendered as a flat position
```

Code references (`@somnia-chain/markets-sdk@0.32.1`):

| Location | Says |
|---|---|
| `src/perp/margin.ts:1046-1048` | "`activePerpPools` is has-position OR has-orders, so an order-only pool appears in this list" |
| `src/accountView/positionsRead.ts:423-424` | Same, and skips `size === 0n` |
| `src/perp/margin.ts:49` (`MarginAccount.activePerpPools`) | "Perp pools where the account holds an open position" (contradicts the two above) |
| `src/perp/margin.ts:1125-1128`, `src/somniaMarketsClient.ts:3871` | "the bank's own list of markets the account has a position in — so a closed position does not linger" |
| `src/perp/margin.ts:1146-1183` | Maps every listed pool to a row, no size filter |

Suggested fix: `continue`/filter `size === 0n` on the priceable arm, as `positionsRead.ts` does. Keep the unpriceable arm's `size` so "a position nobody can price" stays distinguishable. Also correct the `MarginAccount.activePerpPools` and `listPerpPositionAnalytics` docs.

## Evidence

- `repro/01-list-position-analytics-phantom-rows.mjs` with `repro/mockchain.mjs` (mock uses the SDK's own `marginBankReadAbi` / `perpPoolReadAbi` for encoding)
- `evidence/01-phantom-rows.json` after the live run

## Environment

- `@somnia-chain/markets-sdk` 0.32.1 (npm), viem latest, Node 22, Linux
- Live: Somnia Tokyo testnet (Hideki, chain 50383), indexer `https://hideki-dev.smk.somnia.host/v1/graphql`, RPC `wss://api.hideki2.infra.testnet.somnia.network/ws`. These are the bot kit defaults from `packages/perp-core/src/config.ts`.
- Read-only: no signer, no transactions.
- Wallet address: `0xYOUR_WALLET` (fill in before submitting)
