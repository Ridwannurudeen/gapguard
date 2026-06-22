import { describe, expect, it } from "vitest";
import { formatReadinessReport, type ReadinessReport } from "../src/readiness";
import {
  loadGateDrivenBacktestEvidence,
  loadWalkForwardAlphaEvidence,
} from "../src/evidence";

describe("readiness evidence", () => {
  it("loads the current gate-driven backtest as negative alpha", () => {
    const evidence = loadGateDrivenBacktestEvidence();

    expect(evidence.variant).toBe("gateDriven");
    expect(evidence.returnPct).toBeLessThan(0);
    expect(evidence.sharpeAnnualized).toBeLessThan(0);
    expect(evidence.alphaStatus).toBe("negative");
  });

  it("loads walk-forward certification when the artifact exists", () => {
    const evidence = loadWalkForwardAlphaEvidence();
    if (!evidence) return;

    expect(evidence.variant).toBe("walkForwardRwaFollow");
    expect(evidence.totalTrades).toBeGreaterThan(0);
  });

  it("formats blocking readiness checks without hiding failures", () => {
    const report: ReadinessReport = {
      ok: false,
      generatedAt: "2026-06-22T00:00:00.000Z",
      checks: [
        {
          id: "arena-alpha-status",
          status: "fail",
          detail: "alphaStatus=positive, liveStatus=gated",
        },
      ],
    };

    expect(formatReadinessReport(report)).toContain("GapGuard readiness: BLOCKED");
    expect(formatReadinessReport(report)).toContain("FAIL arena-alpha-status");
  });
});
