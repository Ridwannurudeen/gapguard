import { describe, expect, it } from "vitest";
import type { Candle } from "../src/gapEngine";
import { buildNewsBacktestReport } from "../src/newsBacktestReport";
import type { GateVerdictCache } from "../src/gateVerdicts";

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

describe("buildNewsBacktestReport", () => {
  it("uses cached gate verdicts for the gate-driven variant", () => {
    const gateCache: GateVerdictCache = {
      asset: "AAPLUSDT",
      model: "stub-model",
      promptSource: "blinded summaries",
      verdicts: [
        {
          date: "2026-05-13",
          fadeable: false,
          multiplier: 0,
          expectedFadeable: false,
          correct: true,
          returnPct: -0.1,
          rationale: "event risk",
        },
      ],
    };

    const report = buildNewsBacktestReport({
      symbol: "AAPLUSDT",
      interval: "1H",
      candles: [bar(dayA, 100, 100), bar(dayB, 102, 101)],
      catalysts: [
        {
          date: "2026-05-14",
          type: "aapl_event",
          weight: "major",
          description: "label deliberately does not match the trade date",
          confidence: "confirmed",
          source: "fixture",
        },
      ],
      gapThreshold: 0.004,
      costPerSide: 0.0005,
      slippageBps: 1.25,
      slippageSource: "test half-spread",
      startEquity: 1000,
      gateVerdictPath: "data/aaplusdt-gate-verdicts.json",
      gateCache,
    });

    expect(report.variants.alwaysFade.totalTrades).toBe(1);
    expect(report.variants.aaplNewsAware.totalTrades).toBe(1);
    expect(report.variants.gateDriven?.totalTrades).toBe(0);
    expect(report.gateVerdictCache).toMatchObject({
      model: "stub-model",
      standAsideDates: ["2026-05-13"],
    });
    expect(report.params).toMatchObject({
      slippagePerSideBps: 1.25,
      slippageSource: "test half-spread",
    });
    expect(report.skippedOnCatalyst.gate).toEqual([
      { date: "2026-05-13", returnPct: expect.any(Number) },
    ]);
  });

  it("reports gate-driven results as missing until a verdict cache exists", () => {
    const report = buildNewsBacktestReport({
      symbol: "AAPLUSDT",
      interval: "1H",
      candles: [bar(dayA, 100, 100), bar(dayB, 102, 101)],
      catalysts: [],
      gapThreshold: 0.004,
      costPerSide: 0.0005,
      slippageBps: 0,
      slippageSource: "test no spread",
      startEquity: 1000,
      gateVerdictPath: "data/aaplusdt-gate-verdicts.json",
      gateCache: null,
    });

    expect(report.variants.gateDriven).toBeNull();
    expect(report.gateVerdictCache).toMatchObject({
      status: expect.stringContaining("missing"),
    });
  });
});
