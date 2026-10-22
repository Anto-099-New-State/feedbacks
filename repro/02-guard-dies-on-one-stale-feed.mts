// Repro 02 (offline): perp-guard's health read throws for the WHOLE account
// when ANY market the account holds has a stale mark, and perp-guard calls it
// outside its try/catch — so the guard process exits instead of protecting the
// positions it still could.
//
// Chain of calls (bot-kit @ 25798660, SDK 0.32.1):
//   strategies/perp-guard/src/index.ts:137   await marginSnapshot(...)   <- not in the try at :153
//   packages/perp-core/src/margin.ts:42      exchange.client.getMarginAccount(...)
//   SDK src/perp/margin.ts:85                readContract getAccountHealth  (REVERTING view)
// The SDK documents that getAccountHealth reverts when any active market is
// unpriceable (src/perp/margin.ts:547-552), and its own fetchPositions catches
// exactly this (src/unified/exchange.ts, `getLiquidationPrice(...).catch(() => null)`).
// The non-reverting `tryGetAccountEquity` view exists and is in the SDK's ABI.
//
// This script runs the kit's real marginSnapshot + healthRatio over the SDK's
// real getMarginAccount, against a mock MarginBank that behaves as documented:
// BTC (where the account is in danger) has a fresh feed, ETH's feed is stale.
//
// Run: npx tsx repro/02-guard-dies-on-one-stale-feed.mts
import { getMarginAccount } from "../node_modules/@somnia-chain/markets-sdk/dist/perp/margin.js";
import { marginSnapshot, healthRatio } from "../dreamdex-bot-kit/packages/perp-core/src/margin.ts";
import { mockChain, Revert, STALE_REVERT } from "./mockchain.mjs";

const BANK = "0x00000000000000000000000000000000000000b4";
const BTC = "0x0000000000000000000000000000000000000b7c";
const ETH = "0x00000000000000000000000000000000000e7400";
const ME = "0x000000000000000000000000000000000000a11c" as const;
const ONE = 10n ** 18n;

const { client, calls } = mockChain({
  [BANK]: {
    getAccountState: () => ({ unlockedCollateralBalance: 10n * ONE, lockedCollateral: 0n, activePerpPools: [BTC, ETH] }),
    getWithdrawableCollateral: () => 0n,
    getMarginStatus: () => 1, // MarginCall
    // Walks every active pool through the REVERTING getHealthSnapshot; ETH is stale.
    getAccountHealth: () => {
      throw new Revert(STALE_REVERT);
    },
    // The non-reverting twin the SDK already ships in its ABI.
    tryGetAccountEquity: () => [false, 0n],
  },
});

// The minimal slice of SomniaMarkets that marginSnapshot touches.
const exchange = { client: { getMarginAccount: (bank: `0x${string}`, acct: `0x${string}`) => getMarginAccount(bank, acct, client) } };
const btcMarket = { info: { marginBank: BANK, poolAddress: BTC } };

// --- what perp-guard's loop body does for each held market (index.ts:136-138) ---
try {
  const snapshot = await marginSnapshot(exchange as never, btcMarket as never, ME);
  console.log("health", healthRatio(snapshot));
  console.log("OK: health was readable, the guard could act");
  process.exit(0);
} catch (err) {
  console.log("eth_calls made:", calls.join(", "));
  console.log(`marginSnapshot threw: ${(err as Error).name}: ${(err as Error).message.split("\n")[0]}`);
  console.log(
    "BUG: in perp-guard this throw is outside the per-market try/catch (index.ts:137 vs :153), so main() rejects " +
      "and the process exits(1). The BTC position — fresh feed, MarginCall, reducible — is never reduced.",
  );
  process.exit(1);
}
