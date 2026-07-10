import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  PRODUCT_SENTENCE,
  buildEvidenceReport,
  checkEvidenceArtifacts,
  metricsMarkdown,
} from "../src/evidenceReport";

describe("evidenceReport", () => {
  it("builds public metrics directly from committed artifacts", () => {
    const newsAware = JSON.parse(
      readFileSync("artifacts/aaplusdt-news-aware-backtest.json", "utf8"),
    ) as {
      variants: { gateDriven: { totalReturnPct: number; totalTrades: number } };
    };
    const report = buildEvidenceReport("2026-06-22T00:00:00.000Z");

    expect(report.productSentence).toBe(PRODUCT_SENTENCE);
    expect(report.metrics.aaplGateDriven.totalReturnPct).toBe(
      newsAware.variants.gateDriven.totalReturnPct,
    );
    expect(report.metrics.aaplGateDriven.tradeCount).toBe(
      newsAware.variants.gateDriven.totalTrades,
    );
    expect(report.gateHoldout.source).toBe(
      "artifacts/gate-holdout-report.json",
    );
    expect(report.gateHoldout.fullBundleQwenAccuracyCiPct).not.toBeNull();
    expect(
      report.gateHoldout.fullBundleQwenRegretReductionPValue,
    ).not.toBeNull();
    expect(report.boundary).toContain("not regulatory certification");
  });

  it("renders a traceable metrics markdown table", () => {
    const markdown = metricsMarkdown(
      buildEvidenceReport("2026-06-22T00:00:00.000Z"),
    );

    expect(markdown).toContain("AAPLUSDT Qwen gate-driven pilot");
    expect(markdown).toContain("Multi-symbol gate holdout");
    expect(markdown).toContain("95% CI");
    expect(markdown).toContain("Mean-regret reduction CI");
    expect(markdown).toContain("artifacts/aaplusdt-news-aware-backtest.json");
    expect(markdown).toContain(
      "The single live round-trip fill proves the exchange path works end-to-end",
    );
  });

  it("includes the live round-trip fill when artifacts/live-trades.jsonl has a matched open/close pair", () => {
    const report = buildEvidenceReport("2026-06-22T00:00:00.000Z");
    expect(report.liveStockRoundTrip).not.toBeNull();
    expect(report.liveStockRoundTrip?.symbol).toBe("AAPLUSDT");
    expect(report.liveStockRoundTrip?.openPrice).toBeGreaterThan(0);
    expect(report.liveStockRoundTrip?.closePrice).toBeGreaterThan(0);

    const markdown = metricsMarkdown(report);
    expect(markdown).toContain("Live round-trip");
    expect(markdown).toContain(report.liveStockRoundTrip!.openOrderId);
  });

  it("accepts committed evidence blocks regardless of CRLF checkout style", () => {
    expect(() => checkEvidenceArtifacts(buildEvidenceReport())).not.toThrow();
  });
});
