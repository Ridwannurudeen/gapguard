import { describe, expect, it } from "vitest";
import type { Candle } from "../src/gapEngine";
import { buildMultiBacktestReport } from "../src/multiBacktest";

function bar(ts: number, open: number, close: number): Candle {
  return {
    ts,
    open,
    high: Math.max(open, close),
    low: Math.min(open, close),
    close,
    volume: 1,
  };
}

const dayA = Date.UTC(2026, 4, 12, 16, 0, 0);
const dayB = Date.UTC(2026, 4, 13, 16, 0, 0);

describe("buildMultiBacktestReport", () => {
  it("aggregates a broader RWA basket without merging symbols into one fake trade log", () => {
    const report = buildMultiBacktestReport(
      [
        {
          symbol: "AAPLUSDT",
          granularity: "1H",
          candles: [bar(dayA, 100, 100), bar(dayB, 102, 101)],
        },
        {
          symbol: "NVDAUSDT",
          granularity: "1H",
          candles: [bar(dayA, 200, 200), bar(dayB, 198, 199)],
        },
      ],
      {
        gapThreshold: 0.004,
        costPerSide: 0.0005,
        slippageBps: 2.5,
        slippageSource: "test spread",
        startEquity: 1000,
      },
    );

    expect(report.symbols).toHaveLength(2);
    expect(report.aggregate.symbols).toBe(2);
    expect(report.aggregate.totalTrades).toBe(2);
    expect(report.aggregate.maxDrawdownMethod).toContain("worst per-symbol");
    expect(report.params).toMatchObject({
      slippagePerSideBps: 2.5,
      slippageSource: "test spread",
    });
    expect(report.symbols.map((row) => row.symbol)).toEqual([
      "AAPLUSDT",
      "NVDAUSDT",
    ]);
  });
});
