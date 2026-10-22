# API reference: 1,853 boilerplate `@throws` lines list every SDK error on every method, hiding the real failure modes

Severity: normal
Area: docs

## Summary

Almost every method on `SomniaMarketsClient` and `SomniaMarkets` carries the same block of 13–17 `@throws` tags. Each tag has one of five interchangeable sentences ("A supplied RPC constructor or socket interrupts this chain read with this SDK error. The owning read retains its identity."). The list is the SDK's entire error catalogue, not what the method can throw. So:

- Pure chain reads list `SignerRequiredError`, `TransactionOutcomeUnknownError`, `FillHistoryRestartRequiredError`, `BridgeLiquidityError`, `BridgeDeliveryTimeoutError` and `CollateralOnWrongChainError`.
- The real, documented failure mode is mislabelled. `getLiquidationPrice`'s prose says it "throws on a stale mark anywhere in the account", which is a `ContractRevertError` from the MarginBank. Its `@throws {ContractRevertError}` attributes that to "a supplied RPC constructor or socket".
- `getMarginAccount` throws the same way (see report 002), but neither its prose nor its `@throws` block says so.

Editors show these tags on hover, so the reference a bot author sees is uniformly noise. Report 002 is a concrete case of an author not handling a throw the reference never names.

## Steps to reproduce

1. `npm install`
2. Count the boilerplate:
   ```bash
   grep -c 'A supplied RPC constructor or socket interrupts' node_modules/@somnia-chain/markets-sdk/dist/somniaMarketsClient.d.ts   # 959
   grep -c 'A supplied owner RPC constructor or socket member raises' node_modules/@somnia-chain/markets-sdk/dist/somniaMarketsClient.d.ts  # 555
   grep -c 'A supplied owner RPC constructor or socket member raises' node_modules/@somnia-chain/markets-sdk/dist/unified/exchange.d.ts     # 296
   ```
3. Hover `client.getLiquidationPrice` or `client.getPerpPosition` in an editor.

## Expected

Each method lists the errors it can actually raise, each with the condition that raises it. For example:

```ts
/** @throws {ContractRevertError} when any market the account is active in has a stale or zero mark */
getLiquidationPrice(ref: PerpPositionRef): Promise<bigint | null>;
```

## Actual

| File | Boilerplate `@throws` lines | Methods affected | Distinct sentences |
|---|---|---|---|
| `dist/somniaMarketsClient.d.ts` | 1,540 | 113 | 3 |
| `dist/unified/exchange.d.ts` | 313 | 23 | 2 |

Excerpt, `getLiquidationPrice` (abridged):

```ts
 *  … Throws on a stale mark anywhere in the account.
 * @throws {SignerRequiredError} A supplied RPC constructor or socket interrupts this chain read with this SDK error. …
 * @throws {ContractRevertError} A supplied RPC constructor or socket interrupts this chain read with this SDK error. …
 * @throws {BridgeLiquidityError} A supplied RPC constructor or socket interrupts this chain read with this SDK error. …
 * @throws {BridgeDeliveryTimeoutError} A supplied RPC constructor or socket interrupts this chain read with this SDK error. …
getLiquidationPrice(ref: PerpPositionRef): Promise<bigint | null>;
```

`fetchPositions` (a read) lists `CollateralOnWrongChainError`, `BridgeLiquidityError` and `BridgeDeliveryTimeoutError`.

## Evidence

The counts above come from the shipped `.d.ts` files; script in `README.md` ("Measuring report 003").

## Environment
- `@somnia-chain/markets-sdk` 0.32.1 from npm. Static inspection of the published package, no network.
- Network: Somnia Tokyo testnet (Hideki, chain 50383)
- Wallet address: `0xYOUR_WALLET` (fill in before submitting)
