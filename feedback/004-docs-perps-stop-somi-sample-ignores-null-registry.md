# PERPS.md stop-SOMI refund sample passes the nullable `stopRegistry` straight through (fails strict TypeScript; wrong on pools without a registry)

Severity: normal
Area: docs

## Summary

The sample at `docs/PERPS.md:461-462` reads unclaimed stop-order SOMI and claims it:

```ts
const owed = await client.getUnclaimedPerpStopSomi({ registry: perp.stopRegistry, account });
if (owed > 0n) await trader.claimPerpStopSomi({ registry: perp.stopRegistry });
```

`PerpMarket.stopRegistry` is typed `Address | null`, and its own doc says null means "the pool has no registry deployed, and TP/SL is unavailable on it". Both calls require an `Address`. So:

1. Under `strict` the sample doesn't compile (TS2322 twice).
2. A reader who silences the error, or uses JS, hands `null` to `readContract` for any pool without a registry. The SDK doesn't validate the argument (`src/perp/stops.ts:1148-1157`), so the result is whatever viem does with a null address. In a local test with a mock transport, the call never reached `eth_call` and didn't settle within 20 s. The reader gets no clear "this pool has no registry" answer.

This matters most for the wind-down case the paragraph describes, where a reader loops this snippet over every perp market.

## Steps to reproduce

1. `npm install`
2. `npm run check:docs`. This type-checks every `ts` block in the SDK's shipped `docs/PERPS.md` with the SDK's own types, under `strict`.
3. Look for `PERPS_L461`.

## Expected

The sample guards the null case, e.g.:

```ts
if (perp.stopRegistry) {
  const owed = await client.getUnclaimedPerpStopSomi({ registry: perp.stopRegistry, account });
  if (owed > 0n) await trader.claimPerpStopSomi({ registry: perp.stopRegistry });
}
```

## Actual

```
wrap/PERPS_L461.tsx(3,54): error TS2322: Type '`0x${string}` | null' is not assignable to type '`0x${string}`'.
wrap/PERPS_L461.tsx(4,49): error TS2322: Type '`0x${string}` | null' is not assignable to type '`0x${string}`'.
```

`PERPS.md` has 19 TypeScript blocks. Two are not standalone TypeScript and are set aside: L859 has shorthand `{ from, to }` placeholders, and L1194 is the quick start whose symbol casing is already reported elsewhere. Of the remaining 17, this is the only one with a type error against the SDK's own declarations, once free variables are declared with SDK types.

## Evidence

- `docs-check/` harness (`npm run check:docs`); output in `evidence/04-docs-typecheck.txt`
- `dist/markets.d.ts:146` (`PerpMarket.stopRegistry: Address | null`) and its doc comment at `:137-145`

## Environment
- `@somnia-chain/markets-sdk` 0.32.1 from npm, TypeScript 5.9 `strict`, Node 22. Static, no network.
- Network: Somnia Tokyo testnet (Hideki, chain 50383)
- Wallet address: `0xYOUR_WALLET` (fill in before submitting)
