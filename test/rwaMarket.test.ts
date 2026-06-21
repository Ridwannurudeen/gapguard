import { describe, expect, it } from "vitest";
import {
  buildRwaMarketReport,
  suggestedOrderSize,
  type RwaContract,
  type RwaTicker,
} from "../src/rwa-market";

const contracts: RwaContract[] = [
  {
    symbol: "NVDAUSDT",
    isRwa: "YES",
    symbolStatus: "normal",
    minTradeNum: 0.01,
    minTradeUSDT: 5,
    sizeMultiplier: 0.01,
    maxMarketOrderQty: 2400,
    minLever: 1,
    maxLever: 100,
  },
  {
    symbol: "SOXLUSDT",
    isRwa: "YES",
    symbolStatus: "normal",
    minTradeNum: 0.01,
    minTradeUSDT: 5,
    sizeMultiplier: 0.01,
    maxMarketOrderQty: 2400,
    minLever: 1,
    maxLever: 100,
  },
];

const tickers: RwaTicker[] = [
  {
    symbol: "NVDAUSDT",
    lastPrice: 209.41,
    bidPrice: 209.4,
    askPrice: 209.41,
    markPrice: 209.41,
    indexPrice: 209.41,
    quoteVolumeUSDT: 1_231_654.4596,
    holdingAmount: 50_423.16,
    fundingRate: 0,
    ts: "1761066443316",
  },
  {
    symbol: "SOXLUSDT",
    lastPrice: 281.79,
    bidPrice: 281.78,
    askPrice: 281.82,
    markPrice: 281.79,
    indexPrice: 281.79,
    quoteVolumeUSDT: 19_949_803.4571,
    holdingAmount: 84_567.94,
    fundingRate: 0,
    ts: "1761066443316",
  },
];

describe("rwa market report", () => {
  it("rounds the contract minTradeUSDT floor up to the size multiplier", () => {
    expect(suggestedOrderSize(0.01, 5, 0.01, 209.41)).toBe(0.03);
  });

  it("keeps NVDA as the default while surfacing the liquidity leader", () => {
    const report = buildRwaMarketReport(contracts, tickers, {
      generatedAt: "2026-06-21T17:20:00.000Z",
    });

    const nvda = report.rows.find((row) => row.symbol === "NVDAUSDT");
    expect(report.defaultLiveSymbol).toBe("NVDAUSDT");
    expect(report.selectedLiveSymbol).toBe("NVDAUSDT");
    expect(report.liquidityLeader).toBe("SOXLUSDT");
    expect(report.backupSymbol).toBe("SOXLUSDT");
    expect(nvda).toMatchObject({
      liveReady: true,
      suggestedMinSize: 0.03,
    });
    expect(nvda?.suggestedNotionalUSDT).toBeCloseTo(6.2823);
  });
});
