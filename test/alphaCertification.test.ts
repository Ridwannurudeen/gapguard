import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildAlphaCertificationReport } from "../src/alphaCertification";
import { loadWalkForwardAlphaEvidence } from "../src/evidence";

describe("alpha certification", () => {
  it(
    "certifies the locked walk-forward RWA rule without using full-sample winners",
    () => {
      const report = buildAlphaCertificationReport(
        "data/rwa-sample/manifest.json",
        "artifacts/rwa-alpha-certification.json",
        "2026-06-22T00:00:00.000Z",
      );

      expect(report.protocol.splitMethod).toContain("First 60%");
      expect(report.protocol.selectionRule).toContain("last 80 same-direction");
      expect(report.outOfSample.metrics.totalTrades).toBeGreaterThanOrEqual(
        report.protocol.minOosTrades,
      );
      expect(report.outOfSample.metrics.totalReturnPct).toBeGreaterThan(0);
      expect(report.outOfSample.metrics.sharpeAnnualized).toBeGreaterThan(0);
      expect(report.outOfSample.metrics.totalReturnPct).toBeGreaterThan(
        report.baselines.outOfSampleAlwaysFade.totalReturnPct,
      );
      expect(report.passportEvidence).toMatchObject({
        variant: "walkForwardRwaFollow",
        alphaStatus: "positive",
      });
    },
    60_000,
  );

  it("loads a certification artifact as passport alpha evidence", () => {
    const dir = mkdtempSync(join(tmpdir(), "gapguard-alpha-"));
    const path = join(dir, "cert.json");
    writeFileSync(
      path,
      JSON.stringify({
        passportEvidence: {
          source: "artifacts/rwa-alpha-certification.json",
          variant: "walkForwardRwaFollow",
          returnPct: 3.677,
          sharpeAnnualized: 3.129,
          totalTrades: 119,
          alphaStatus: "positive",
          note: "positive fixture",
        },
      }),
    );

    expect(loadWalkForwardAlphaEvidence(path)).toEqual({
      source: path,
      variant: "walkForwardRwaFollow",
      returnPct: 3.677,
      sharpeAnnualized: 3.129,
      totalTrades: 119,
      alphaStatus: "positive",
      note: "positive fixture",
    });
  });
});
