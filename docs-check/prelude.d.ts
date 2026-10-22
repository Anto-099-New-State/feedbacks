import type { SomniaMarketsClient, Trader, PerpMarket } from "@somnia-chain/markets-sdk";
declare global {
  const client: SomniaMarketsClient;
  const trader: Trader;
  const main: { trader: Trader }; const child: { trader: Trader };
  const account: `0x${string}`; const marginBank: `0x${string}`; const pool: `0x${string}`;
  const childAddress: `0x${string}`; const mainAddress: `0x${string}`;
  const perp: PerpMarket; const price: bigint; const quantity: bigint;
  const since: number; const chainId: number; const perpMarketId: string;
  const fills: Parameters<SomniaMarketsClient["listPerpPositionChangesForFills"]>[1];
}
export {};
