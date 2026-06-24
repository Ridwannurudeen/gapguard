import { describe, expect, it } from "vitest";
import {
  buildCatalystBundle,
  buildOperationalCatalystBundle,
  formatCatalystBundle,
  parseCatalystBundle,
} from "../src/catalystBundle";

describe("catalyst bundle", () => {
  it("adds four pre-decision sections including scheduled macro fixtures", () => {
    const bundle = buildCatalystBundle({
      asset: "AAPLUSDT",
      date: "2026-06-05",
      newsSummary:
        "- 2026-06-05 Apple shares open higher before jobs data (Finnhub)\n",
    });
    const formatted = formatCatalystBundle(bundle);

    expect(formatted).toContain("COMPANY_NEWS:");
    expect(formatted).toContain("SCHEDULED_MACRO:");
    expect(formatted).toContain("INDEX_FUTURES:");
    expect(formatted).toContain("CROSS_ASSET:");
    expect(formatted).toContain("[macro-2026-06-05-jobs]");
  });

  it("rejects catalyst records that leak after the decision timestamp", () => {
    expect(() =>
      parseCatalystBundle(
        {
          decisionTimestamp: "2026-06-05T13:30:00.000Z",
          companyNews: [
            {
              id: "late-company",
              section: "companyNews",
              timestamp: "2026-06-05T14:00:00.000Z",
              source: "test",
              text: "late headline",
            },
          ],
          scheduledMacro: [],
          indexFutures: [],
          crossAsset: [],
        },
        "fixture",
      ),
    ).toThrow("is not before decision");
  });

  it("uses live feed only when explicitly passed and filters future operational rows", () => {
    const historical = buildCatalystBundle({
      asset: "AAPLUSDT",
      date: "2026-06-05",
      newsSummary: "No Apple-specific headline before the open.",
    });
    const live = buildOperationalCatalystBundle({
      asset: "AAPLUSDT",
      newsSummary: "fallback summary",
      decisionTimestamp: "2026-06-24T12:00:00.000Z",
      liveFeed: {
        generatedAt: "2026-06-24T11:30:00.000Z",
        sources: ["fixture"],
        notes: ["fixture"],
        dropped: {
          stock: 0,
          macroPolicy: 0,
          indexCrossAsset: 0,
          economicCalendar: 0,
        },
        categories: {
          stock: [
            {
              id: "stock-past",
              headline: "Apple supplier update",
              summary: "before decision",
              source: "fixture",
              url: "https://example.test/past",
              ts: "2026-06-24T11:00:00.000Z",
              symbols: ["AAPL"],
            },
            {
              id: "stock-future",
              headline: "Apple future leak",
              summary: "after decision",
              source: "fixture",
              url: "https://example.test/future",
              ts: "2026-06-24T13:00:00.000Z",
              symbols: ["AAPL"],
            },
          ],
          macroPolicy: [],
          indexCrossAsset: [],
          economicCalendar: [],
        },
      },
    });

    expect(formatCatalystBundle(historical)).toContain(
      "committed macro calendar fixture",
    );
    expect(formatCatalystBundle(live)).toContain("stock-past");
    expect(formatCatalystBundle(live)).not.toContain("stock-future");
  });
});
