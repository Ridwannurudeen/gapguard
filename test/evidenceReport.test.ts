import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  PRODUCT_SENTENCE,
  buildEvidenceReport,
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
    expect(report.boundary).toContain("not regulatory certification");
  });

  it("renders a traceable metrics markdown table", () => {
    const markdown = metricsMarkdown(
      buildEvidenceReport("2026-06-22T00:00:00.000Z"),
    );

    expect(markdown).toContain("AAPLUSDT Qwen gate-driven pilot");
    expect(markdown).toContain("Multi-symbol gate holdout");
    expect(markdown).toContain("artifacts/aaplusdt-news-aware-backtest.json");
    expect(markdown).toContain("No live on-exchange RWA stock fill");
  });
});
