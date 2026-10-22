// Read-only live evidence for the dreamDEX Perps feedback reports.
// No keys, no signatures, no transactions. Writes evidence/*.json and prints a summary.
//
//   npm install            (in this folder)
//   npx tsx live/collect-evidence.mts
//
// Endpoints are the bot kit's Hideki defaults (packages/perp-core/src/config.ts).
// Override with HIDEKI_WS / HIDEKI_INDEXER if they move.
import { mkdirSync, writeFileSync } from "node:fs";
import { defineChain, type Address } from "viem";
import { SomniaMarkets } from "@somnia-chain/markets-sdk";

const WS = process.env.HIDEKI_WS ?? "wss://api.hideki2.infra.testnet.somnia.network/ws";
const HTTP = process.env.HIDEKI_RPC ?? "https://api.hideki2.infra.testnet.somnia.network";
const INDEXER = process.env.HIDEKI_INDEXER ?? "https://hideki-dev.smk.somnia.host/v1/graphql";
const MAX_OWNERS = Number(process.env.MAX_OWNERS ?? 150);
const MAX_HOLDERS = Number(process.env.MAX_HOLDERS ?? 40);
const FUNDING_DAYS = Number(process.env.FUNDING_DAYS ?? 7);

const chain = defineChain({
  id: 50383,
  name: "Somnia Hideki",
  nativeCurrency: { name: "Somnia", symbol: "SOMI", decimals: 18 },
  rpcUrls: { default: { http: [HTTP], webSocket: [WS] } },
});
const exchange = new SomniaMarkets({ chain, wsRpcUrl: WS, indexerUrl: INDEXER });
const client = exchange.client;
const json = (v: unknown) => JSON.stringify(v, (_, x) => (typeof x === "bigint" ? x.toString() : x), 2);
const errText = (e: unknown) => (e instanceof Error ? `${e.name}: ${e.message.split("\n")[0]}` : String(e));
mkdirSync("evidence", { recursive: true });

const env = { at: new Date().toISOString(), chainId: 50383, ws: WS, indexer: INDEXER, sdk: "0.32.1", node: process.version };
const head = await client.getHeadBlock().catch(() => undefined);
const markets = await client.listPerpMarkets({ limit: 100 });
console.log(`${markets.length} perp markets, head block ${head ?? "?"}`);

// ---------------------------------------------------------------- 01
// Accounts with RESTING orders: are their order-only pools returned by
// listPerpPositionAnalytics as zero-size "priceable" rows?
const owners = new Map<string, Address>(); // owner -> marginBank
for (const m of markets) {
  for (const isBid of [true, false]) {
    try {
      const { orders } = await client.getAllOpenOrdersOnchain(m.poolAddress as Address, { isBid, maxCount: 200 });
      for (const o of orders) if (owners.size < MAX_OWNERS) owners.set(o.owner.toLowerCase(), m.marginBank as Address);
    } catch (e) {
      console.log(`  open orders ${m.baseSymbol} ${isBid ? "bids" : "asks"}: ${errText(e)}`);
    }
  }
}
const phantom: unknown[] = [];
for (const [owner, marginBank] of owners) {
  try {
    const rows = await client.listPerpPositionAnalytics({ marginBank, account: owner as Address });
    const zero = rows.filter((r) => r.priceable && r.size === 0n);
    if (zero.length) phantom.push({ account: owner, marginBank, totalRows: rows.length, zeroSizeRows: zero.map((r) => ({ pool: r.pool, size: r.size, notional: (r as { notional?: bigint }).notional })) });
  } catch (e) {
    /* an unpriceable market elsewhere in the account is report 02's subject, not this one */
  }
}
writeFileSync("evidence/01-phantom-rows.json", json({ env, ownersScanned: owners.size, accountsWithZeroRows: phantom.length, examples: phantom.slice(0, 20) }));
console.log(`[01] ${phantom.length} of ${owners.size} order-holding accounts get zero-size priceable rows`);

// ---------------------------------------------------------------- 02
// Unpriceable pools, and what getMarginAccount (perp-guard's health read) does
// for the accounts holding positions in them.
const feeds = await Promise.all(
  markets.map(async (m) => {
    try {
      const f = await client.getPerpFeedStatus(m.poolAddress as Address);
      return { market: m.baseSymbol, pool: m.poolAddress, marginBank: m.marginBank, live: f.markPriceOk && f.markPrice > 0n, feed: f };
    } catch (e) {
      return { market: m.baseSymbol, pool: m.poolAddress, marginBank: m.marginBank, live: false, error: errText(e) };
    }
  }),
);
const dead = feeds.filter((f) => !f.live);
const affected: unknown[] = [];
for (const d of dead) {
  for (const isLong of [true, false]) {
    let holders: Address[] = [];
    try {
      ({ holders } = await client.getPerpSideHolders({ marginBank: d.marginBank as Address, pool: d.pool as Address, isLong }));
    } catch (e) {
      console.log(`  holders ${d.market}: ${errText(e)}`);
    }
    for (const h of holders.slice(0, MAX_HOLDERS)) {
      const row: Record<string, unknown> = { account: h, stalePool: d.market, side: isLong ? "long" : "short" };
      try {
        await client.getMarginAccount(d.marginBank as Address, h);
        row.getMarginAccount = "ok";
      } catch (e) {
        row.getMarginAccount = errText(e);
      }
      // What the guard COULD still act on: other markets held, with live feeds.
      try {
        const rows = await client.listPerpPositionAnalytics({ marginBank: d.marginBank as Address, account: h });
        row.otherLivePositions = rows
          .filter((r) => r.priceable && r.size !== 0n && r.pool.toLowerCase() !== String(d.pool).toLowerCase())
          .map((r) => ({ pool: r.pool, size: r.size }));
      } catch (e) {
        row.otherLivePositions = errText(e);
      }
      affected.push(row);
    }
  }
}
const reverted = affected.filter((r) => String((r as { getMarginAccount: string }).getMarginAccount) !== "ok");
writeFileSync("evidence/02-stale-feed-health.json", json({ env, unpriceableMarkets: dead, accountsChecked: affected.length, healthReadFailed: reverted.length, accounts: affected }));
console.log(`[02] ${dead.length} unpriceable market(s): ${dead.map((d) => d.market).join(", ") || "none right now"}; getMarginAccount failed for ${reverted.length}/${affected.length} holders`);

// ---------------------------------------------------------------- 03 (candidate)
// Funding forgiven by lazy settlement: intervals spanned vs intervals accrued.
const since = Math.floor(Date.now() / 1000) - FUNDING_DAYS * 86400;
const funding: unknown[] = [];
for (const m of markets) {
  try {
    const rows = await client.listFundingRateHistory(m.poolAddress, { from: since, order: "desc", limit: 1000 });
    let settled = 0, accrued = 0, gaps = 0;
    for (const r of rows) {
      const s = Number(r.intervalsSettled), a = Number(r.intervalsAccrued);
      settled += s; accrued += a; if (s > a) gaps++;
    }
    funding.push({ market: m.baseSymbol, settlements: rows.length, intervalsSpanned: settled, intervalsAccrued: accrued, forgiven: settled - accrued, forgivenPct: settled ? +((100 * (settled - accrued)) / settled).toFixed(2) : null, settlementsWithForgiveness: gaps });
  } catch (e) {
    funding.push({ market: m.baseSymbol, error: errText(e) });
  }
}
writeFileSync("evidence/03-funding-forgiven.json", json({ env, windowDays: FUNDING_DAYS, markets: funding }));
console.log(`[03] funding forgiven over ${FUNDING_DAYS}d:`);
for (const f of funding as Array<Record<string, unknown>>) console.log(`     ${String(f.market).padEnd(8)} ${f.error ?? `${f.forgiven}/${f.intervalsSpanned} intervals (${f.forgivenPct}%)`}`);

console.log("\nevidence written to ./evidence");
process.exit(0);
