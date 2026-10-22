// Repro 01 (offline): listPerpPositionAnalytics returns a "priceable", all-zero
// row for a pool where the account only has RESTING ORDERS, contradicting its
// own contract ("Every position the account actually holds").
//
// The MarginBank's activePerpPools is "has-position OR has-orders" — the SDK
// says so itself in two places:
//   src/perp/margin.ts:1046            (PerpPositionAnalytics doc)
//   src/accountView/positionsRead.ts:423 ("also lists pools where the account
//                                         only has resting orders" -> `continue`)
// listPerpPositionAnalytics (src/perp/margin.ts:1134) maps every listed pool
// to a row and never applies that `size === 0n` filter.
//
// Run: node repro/01-list-position-analytics-phantom-rows.mjs
import { listPerpPositionAnalytics } from "../node_modules/@somnia-chain/markets-sdk/dist/perp/margin.js";
import { mockChain } from "./mockchain.mjs";

const BANK = "0x00000000000000000000000000000000000000b4";
const BTC = "0x0000000000000000000000000000000000000b7c"; // holds a real long
const ETH = "0x00000000000000000000000000000000000e7400"; // only a resting bid
const ACCOUNT = "0x000000000000000000000000000000000000a11c";
const ONE = 10n ** 18n;

const snapshot = (mark) => [
  true,
  {
    oneBase: ONE,
    markPrice: mark,
    projectedCumulativeFunding: 0n,
    effectiveIMFBps: 500n,
    maintenanceMarginBps: 250n,
    closeOutMarginBps: 150n,
  },
];

const { client } = mockChain({
  [BANK]: {
    // Both pools are "active": BTC because of the position, ETH because of the order.
    getAccountState: () => ({
      unlockedCollateralBalance: 900n * ONE,
      lockedCollateral: 100n * ONE,
      activePerpPools: [BTC, ETH],
    }),
    getPosition: ([, pool]) =>
      pool.toLowerCase() === BTC
        ? { size: ONE / 100n, avgEntryPrice: 80_000n * ONE, entryFundingIndex: 0n, lastUpdatedTimestampNs: 1n }
        : { size: 0n, avgEntryPrice: 0n, entryFundingIndex: 0n, lastUpdatedTimestampNs: 0n },
  },
  [BTC]: { tryGetHealthSnapshot: () => snapshot(82_000n * ONE) },
  [ETH]: { tryGetHealthSnapshot: () => snapshot(3_000n * ONE) },
});

const rows = await listPerpPositionAnalytics({ marginBank: BANK, account: ACCOUNT }, client);
const show = (r) =>
  JSON.stringify(
    { pool: r.pool, priceable: r.priceable, size: r.size, notional: r.notional, unrealizedPnl: r.unrealizedPnl, returnOnMarginBps: r.returnOnMarginBps },
    (_, v) => (typeof v === "bigint" ? v.toString() : v),
  );

console.log(`rows returned: ${rows.length} (account holds 1 position)`);
for (const r of rows) console.log("  " + show(r));
const phantom = rows.filter((r) => r.priceable && r.size === 0n);
console.log(
  phantom.length
    ? `BUG: ${phantom.length} row(s) with priceable=true and size=0 — an order-only pool rendered as a flat position`
    : "OK: no zero-size rows",
);
process.exit(phantom.length ? 1 : 0);
