# perp-guard exits when ANY held market's mark is stale, leaving every other position unguarded

Severity: major
Area: SDK

## Summary

`perp-guard` reads account health with `perp-core`'s `marginSnapshot`, which calls the SDK's `getMarginAccount`. That in turn reads the MarginBank's **reverting** `getAccountHealth` view. The SDK documents that this view walks every market the account is active in through the reverting `getHealthSnapshot`, "so one dead feed anywhere in the account reverts this read" (`src/perp/margin.ts:547-552`).

In `perp-guard` the call sits **outside** the per-market `try/catch` (`index.ts:137` vs `:153`). So one stale oracle on any market the account holds makes `main()` reject and the process `exit(1)`. Margin is cross, and the guard's own docs stress this, so the stale market need not be the one in danger. A BTC position at `MarginCall` with a perfectly live feed stops being guarded because the account also holds ETH, whose feed went stale.

This is the scenario the guard's docstring calls "exactly when a guard is worth having" (`index.ts:59-66`).

Under the kit's own Railway template (`railway.toml`: `restartPolicyType = "ON_FAILURE"`, `restartPolicyMaxRetries = 10`), the guard crash-loops and then stays down. For as long as the feed is stale, every restart hits the same revert on the first loop iteration. The three trading strategies run the same read in `preflight()` at startup (`perp-funding:80`, `perp-maker:94`, `perp-starter:86`), so none of them can start for such an account either.

The SDK's `getMarginAccount` doc doesn't mention this throw, while `getLiquidationPrice`'s does. The SDK's own `fetchPositions` explicitly contains the same failure (`getLiquidationPrice(...).catch(() => null)`, "degrade … so a position still lists if the health read reverts"). A non-reverting `tryGetAccountEquity` view is already in the SDK's ABI and used by `listMarginEquities`.

## Steps to reproduce

**Offline (deterministic):**
1. Clone `somnia-chain/dreamdex-bot-kit` next to this folder (at `25798660`), then `npm install`.
2. `npx tsx repro/02-guard-dies-on-one-stale-feed.mts`

The script runs the kit's real `marginSnapshot` + `healthRatio` over the SDK's real `getMarginAccount`. It uses a mock MarginBank that behaves as the SDK documents: the account is active in BTC (live, `MarginCall`) and ETH (stale), so `getAccountHealth` reverts.

**Live (read-only):**
1. `npx tsx live/collect-evidence.mts`
2. Section `[02]` lists unpriceable markets (`getPerpFeedStatus`) and enumerates their holders (`getPerpSideHolders`). For each holder it records whether `getMarginAccount` throws and which *other* live positions the guard could still have reduced. Output goes to `evidence/02-stale-feed-health.json`.

**End-to-end (testnet funds):** hold positions in two markets; when one market's feed is reported `markPriceOk: false`, run `DRY_RUN=true npm start -w perp-guard`. The process exits on its first loop.

## Expected

The guard keeps running through an oracle outage. It reports the stale market, and it keeps measuring and reducing positions it still can. At minimum the health read should be inside the try/catch, with a non-reverting fallback (e.g. `tryGetAccountEquity` plus per-pool `listPerpPositionAnalytics`, which already returns `{ priceable: false }` per row instead of throwing).

## Actual

```
eth_calls made: …getAccountState, …getWithdrawableCollateral, …getAccountHealth, …getMarginStatus, …getAccountHealth ×3
marginSnapshot threw: ContractFunctionExecutionError: The contract function "getAccountHealth" reverted …
BUG: in perp-guard this throw is outside the per-market try/catch (index.ts:137 vs :153), so main() rejects
and the process exits(1). The BTC position — fresh feed, MarginCall, reducible — is never reduced.
```

```ts
// strategies/perp-guard/src/index.ts
135  for (const market of markets) {
137    const snapshot = await marginSnapshot(ctx.exchange, market, me);  // throws on any stale held market
       …
153    try {                                                               // only the close is protected
```

## Suggested fix

- **Kit:** move the snapshot into the `try`. Read health once per loop rather than once per market, since it is account-wide. On failure, fall back to `tryGetAccountEquity` and per-row analytics, and keep reducing priceable positions.
- **SDK:** document on `getMarginAccount` / `getAccountHealth` that they throw `ContractRevertError` when any active market is unpriceable, as `getLiquidationPrice` already does. Consider a `tryGetMarginAccount` that returns a `priceable: false` arm.

## Evidence

- `repro/02-guard-dies-on-one-stale-feed.mts` with `repro/mockchain.mjs`
- `evidence/02-stale-feed-health.json` after the live run
- SDK `src/perp/margin.ts:547-552`, `:82-87`; `src/unified/exchange.ts` (fetchPositions, `getLiquidationPrice(...).catch`)
- Bot kit `strategies/perp-guard/src/index.ts:59-66, 135-160`; `packages/perp-core/src/margin.ts:37-55`; `railway.toml`

## Environment

- `somnia-chain/dreamdex-bot-kit` @ `25798660bbe4674a6f83a960b202852896e2fed4`
- `@somnia-chain/markets-sdk` 0.32.1, viem latest, tsx 4, Node 22, Linux
- Live: Somnia Tokyo testnet (Hideki, chain 50383), endpoints from `packages/perp-core/src/config.ts`. Read-only.
- Wallet address: `0xYOUR_WALLET` (fill in before submitting)
