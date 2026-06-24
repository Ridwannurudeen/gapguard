import { describe, expect, it } from "vitest";
import type { Candle } from "../src/gapEngine";
import { buildGateHoldoutReport } from "../src/gateHoldoutReport";

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

function session(day: number, open: number, close: number): Candle {
  return bar(Date.UTC(2026, 5, day, 16, 0, 0), open, close);
}

describe("gate holdout report", () => {
  it("evaluates fixed ablations with a cost-weighted confusion matrix", () => {
    const report = buildGateHoldoutReport({
      manifestPath: "data/rwa-sample/manifest.json",
      gateVerdictPath: "data/aaplusdt-gate-verdicts.json",
      fixtures: [
        {
          symbol: "AAPLUSDT",
          candles: [
            session(1, 100, 100),
            session(2, 102, 101),
            session(3, 99, 99.8),
            session(4, 101, 100.5),
          ],
        },
        {
          symbol: "NVDAUSDT",
          candles: [
            session(1, 200, 200),
            session(2, 198, 199),
            session(3, 201, 202),
            session(4, 199, 198.5),
          ],
        },
      ],
      gateCache: null,
      generatedAt: "2026-06-23T00:00:00.000Z",
      env: {},
    });

    expect(report.data.symbols).toEqual(["AAPLUSDT", "NVDAUSDT"]);
    expect(report.data.candidates).toBeGreaterThan(2);
    expect(report.data.holdoutCandidates).toBeGreaterThan(0);
    expect(report.variants[0]).toMatchObject({
      name: "always_fade",
      status: "evaluated",
    });
    expect(report.variants[0].confusion.FADE.FADE.count).toBeGreaterThanOrEqual(
      0,
    );
    expect(report.variants.find((row) => row.name === "full_bundle_qwen_gate")).toMatchObject({
      status: "not_run_missing_key",
      evaluated: 0,
    });
  });
});
