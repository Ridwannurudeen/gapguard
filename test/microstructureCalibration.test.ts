import { describe, expect, it } from "vitest";
import { buildMicrostructureCalibrationReport } from "../src/microstructureCalibration";

describe("microstructure calibration assessment", () => {
  it("reports insufficient data when outcomes and microstructure features are not joined", () => {
    const report = buildMicrostructureCalibrationReport({
      generatedAt: "2026-06-25T00:00:00.000Z",
      historicalOutcomeRows: [
        { symbol: "NVDAUSDT", returnPct: 0.2 },
        { symbol: "AAPLUSDT", returnPct: -0.1 },
      ],
      currentFeatureRows: [
        {
          symbol: "NVDAUSDT",
          spreadBps: 2,
          quoteVolumeUSDT: 1_000_000,
          fundingRate: 0,
        },
      ],
      liveFeatureRows: [],
      minimumRows: 2,
    });

    expect(report.status).toBe("insufficient_labeled_microstructure_history");
    expect(report.coverage.usableLabeledFeatureRows).toBe(0);
    expect(report.decision).toContain("do not claim calibrated");
    expect(report.reliabilityCurve).toEqual([]);
  });

  it("marks the dataset ready only when labeled point-in-time feature rows exist", () => {
    const labeled = {
      symbol: "NVDAUSDT",
      decisionTimestamp: "2026-06-25T00:00:00.000Z",
      spreadBps: 2,
      quoteVolumeUSDT: 1_000_000,
      fundingRate: 0,
      premiumDiscountBps: 30,
      outcomeReturnPct: 0.4,
    };
    const report = buildMicrostructureCalibrationReport({
      generatedAt: "2026-06-25T00:00:00.000Z",
      historicalOutcomeRows: [labeled, { ...labeled, symbol: "AAPLUSDT" }],
      currentFeatureRows: [],
      liveFeatureRows: [],
      minimumRows: 2,
    });

    expect(report.status).toBe("ready_to_fit");
    expect(report.coverage.usableLabeledFeatureRows).toBe(2);
  });
});
