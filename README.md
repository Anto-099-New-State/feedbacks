# dreamDEX Perps — feedback track

Feedback reports for the **dreamDEX Perps Builder Bounty** (DoraHacks), feedback track. Each file in `feedback/` is one reproducible item in the program's format: title, severity, area, steps, expected, actual, evidence, environment.

| # | Title | Severity | Area |
|---|---|---|---|
| 001 | `listPerpPositionAnalytics` returns zero-size "priceable" rows for order-only pools | normal | SDK |
| 002 | `perp-guard` exits when any held market's mark is stale, leaving every other position unguarded | **major** | SDK (bot kit `perp-guard`) |
| 003 | 1,853 boilerplate `@throws` lines list every SDK error on every method | normal | docs |
| 004 | PERPS.md stop-SOMI refund sample passes the nullable `stopRegistry` straight through | normal | docs |

Each of the four was checked against the public submissions of other participants available on 2026-10-22, and none duplicates them. Acceptance, duplicate status, severity and payment are the organizer's call.

## Reproduce

```bash
npm install
git clone https://github.com/somnia-chain/dreamdex-bot-kit && git -C dreamdex-bot-kit checkout 25798660bbe4674a6f83a960b202852896e2fed4

npm run repro:01      # offline — exits 1 and prints the zero-size row
npm run repro:02      # offline — exits 1 when the guard's health read throws
npm run check:docs    # offline — type-checks docs/PERPS.md samples (report 004)
npm run live          # read-only on Hideki — writes evidence/*.json for 001, 002 and the candidate below
```

The offline repros run the SDK's **real** code against `repro/mockchain.mjs`. This is a viem `PublicClient` whose `eth_call`s are answered by small handlers, with encoding done by the SDK's own read ABIs. The bot-kit repro imports the kit's real `perp-core` source. The mocks implement only what the SDK itself documents about the contracts; the code locations are cited in each report.

`npm run live` uses no key and sends no transactions. It runs against the bot kit's Hideki defaults (`packages/perp-core/src/config.ts`); override with `HIDEKI_WS`, `HIDEKI_RPC` or `HIDEKI_INDEXER`.

### Measuring report 003

```bash
for f in somniaMarketsClient unified/exchange; do
  grep -cE 'A supplied (owner )?(RPC|WebSocket) constructor' node_modules/@somnia-chain/markets-sdk/dist/$f.d.ts
done
```

## Candidate (not filed): funding forgiven by lazy settlement

The SDK documents that a settlement charges at most **one interval** however long the gap was, and that the excess is forgiven (`src/funding.ts:128-133`, `FundingRateUpdate.intervalsSettled` vs `intervalsAccrued`). Settlement is permissionless and lazy. The bot kit's `perp-funding` strategy quotes `annualizedFundingRate`, which assumes every interval settles, and it never calls `pokeFunding`. If settlements regularly lag, the carry it targets is partly never paid.

Section `[03]` of `npm run live` measures this per market over the last 7 days (`evidence/03-funding-forgiven.json`). Worth filing only if the forgiven share is material.

## Environment

- `@somnia-chain/markets-sdk` 0.32.1 (npm), viem 2, TypeScript 5.9, tsx 4, Node 22, Linux
- `somnia-chain/dreamdex-bot-kit` @ `25798660bbe4674a6f83a960b202852896e2fed4`
- Somnia Tokyo testnet (Hideki, chain 50383)

## Before submitting (from the bounty brief)

- [ ] Your DoraHacks email is whitelisted. Builds can only be submitted from whitelisted emails: open a ticket in the dreamDEX Discord or message the SomniaHacks Telegram group.
- [ ] Replace `0xYOUR_WALLET` in each report's Environment section.
- [ ] Run `npm run live` and commit `evidence/*.json`.
- [ ] Push to a public GitHub repo and submit it as a Build before **November 1, 23:59 UTC**. Only the first valid report of an issue is paid, so earlier is better.
