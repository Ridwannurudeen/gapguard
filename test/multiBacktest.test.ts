import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Candle } from "../src/gapEngine";
import {
  buildMultiBacktestReport,
  loadCandleFixture,
  loadRwaSampleManifest,
} from "../src/multiBacktest";
import type { ExecutionAssumptionSet } from "../src/slippage";

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

function executionAssumptions(
  overrides: Partial<ExecutionAssumptionSet["fallback"]> = {},
): ExecutionAssumptionSet {
  const fallback = {
    symbol: "FALLBACK",
    slippageBps: 2.5,
    fundingRate: 0,
    minTradeNum: 0.0001,
    sizeMultiplier: 1,
    minNotionalUSDT: 1,
    source: "test execution",
    ...overrides,
  };
  return {
    bySymbol: {
      AAPLUSDT: { ...fallback, symbol: "AAPLUSDT" },
      NVDAUSDT: { ...fallback, symbol: "NVDAUSDT" },
    },
    fallback,
    source: "test execution",
  };
}

function tempJson(name: string, value: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), "gapguard-rwa-"));
  const path = join(dir, name);
  writeFileSync(path, `${JSON.stringify(value)}\n`);
  return path;
}

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
        executionAssumptions: executionAssumptions(),
        startEquity: 1000,
      },
    );

    expect(report.symbols).toHaveLength(2);
    expect(report.aggregate.symbols).toBe(2);
    expect(report.aggregate.totalTrades).toBe(2);
    expect(report.aggregate.maxDrawdownMethod).toContain(
      "synchronized daily",
    );
    expect(report.aggregate.portfolioTradingDays).toBe(1);
    expect(report.aggregate.rejectedOrders).toBe(0);
    expect(report.aggregate.grossExposurePct).toBeGreaterThan(0);
    expect(report.aggregate.cashPct).toBe(100);
    expect(report.params).toMatchObject({
      slippagePerSideBps: 2.5,
      slippageSource: "per-symbol execution assumptions",
      executionAssumptionSource: "test execution",
    });
    expect(report.symbols[0].execution).toMatchObject({
      symbol: "AAPLUSDT",
      slippageBps: 2.5,
    });
    expect(report.symbols.map((row) => row.symbol)).toEqual([
      "AAPLUSDT",
      "NVDAUSDT",
    ]);
  });

  it("records min-size rejects instead of counting impossible fills", () => {
    const report = buildMultiBacktestReport(
      [
        {
          symbol: "AAPLUSDT",
          granularity: "1H",
          candles: [bar(dayA, 100, 100), bar(dayB, 102, 101)],
        },
      ],
      {
        gapThreshold: 0.004,
        costPerSide: 0.0005,
        executionAssumptions: executionAssumptions({
          minTradeNum: 10,
          minNotionalUSDT: 10_000,
        }),
        startEquity: 1000,
      },
    );

    expect(report.symbols[0].trades).toHaveLength(0);
    expect(report.symbols[0].rejectedOrders).toBe(1);
    expect(report.aggregate.rejectedOrders).toBe(1);
    expect(report.aggregate.totalTrades).toBe(0);
  });

  it("rejects malformed RWA manifests with a field path", () => {
    const path = tempJson("manifest.json", {
      symbols: [{ symbol: "AAPLUSDT" }],
    });

    expect(() => loadRwaSampleManifest(path)).toThrow(
      `${path}: symbols[0].file must be a non-empty string`,
    );
  });

  it("rejects malformed candle fixtures with a field path", () => {
    const path = tempJson("aaplusdt.json", {
      symbol: "AAPLUSDT",
      granularity: "1H",
      candles: [
        {
          ts: Date.UTC(2026, 4, 12),
          open: "100",
          high: 101,
          low: 99,
          close: 100,
          volume: 1,
        },
      ],
    });

    expect(() => loadCandleFixture(path)).toThrow(
      `${path}: candles[0].open must be a finite number`,
    );
  });
});
