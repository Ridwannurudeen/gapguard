import { describe, expect, it } from "vitest";
import {
  buildNewsFeed,
  isIndexCrossAssetItem,
  macroPolicyTags,
  normalizeFinnhubNewsRows,
} from "../src/fetchNewsFeed";
import { parseNewsFeed } from "../src/newsFeed";

describe("fetchNewsFeed helpers", () => {
  it("categorizes filtered general news without claiming a curated political desk", () => {
    const tags = macroPolicyTags({
      headline: "Fed rate decision and election tariff risk move markets",
      summary: "Treasury yields rise after CPI and FOMC remarks.",
    });

    expect(tags).toEqual(
      expect.arrayContaining(["election", "fed", "inflation", "rates", "tariffs"]),
    );
  });

  it("detects index and cross-asset market news", () => {
    expect(
      isIndexCrossAssetItem({
        headline: "S&P futures fall as VIX rises and oil rallies",
        summary: "Dollar strength hits equities before the US open.",
      }),
    ).toBe(true);
  });

  it("dedupes, caps, sanitizes, and round-trips the feed schema", () => {
    const general = normalizeFinnhubNewsRows([
      {
        datetime: 1_781_000_000,
        headline: "Fed\u0000 rates jolt Nasdaq futures",
        summary: "FOMC comments move yields and the dollar.",
        source: "Reuters",
        url: "https://example.test/fed",
      },
      {
        datetime: 1_781_000_000,
        headline: "Fed rates jolt Nasdaq futures",
        summary: "duplicate",
        source: "Reuters",
        url: "https://example.test/fed",
      },
      {
        datetime: 1_780_900_000,
        headline: "Oil and bitcoin rally as dollar slips",
        summary: "Cross-asset pressure before the open.",
        source: "MarketWatch",
        url: "https://example.test/cross",
      },
    ]);
    const stock = normalizeFinnhubNewsRows(
      [
        {
          datetime: 1_781_010_000,
          headline: "Apple supplier update lifts AAPL",
          summary: "Company-specific headline before the open.",
          source: "CNBC",
          url: "https://example.test/aapl",
        },
      ],
      ["AAPL"],
    );

    const feed = buildNewsFeed({
      generatedAt: "2026-06-24T12:00:00.000Z",
      stockItems: stock,
      generalItems: general,
      economicCalendarItems: [
        {
          id: "pending",
          event: "FOMC decision",
          country: "US",
          ts: "2026-06-24T11:00:00.000Z",
          source: "scheduled calendar (committed)",
          actual: null,
          estimate: null,
          prior: null,
        },
      ],
      sources: ["Finnhub /news?category=general"],
      notes: ["Macro & Policy is filtered general market news."],
      cap: 1,
    });
    const parsed = parseNewsFeed(JSON.parse(JSON.stringify(feed)) as unknown, "$");

    expect(parsed.categories.stock).toHaveLength(1);
    expect(parsed.categories.macroPolicy).toHaveLength(1);
    expect(parsed.categories.macroPolicy[0].tags).toEqual(
      expect.arrayContaining(["fed", "rates"]),
    );
    expect(parsed.categories.indexCrossAsset).toHaveLength(1);
    expect(parsed.categories.economicCalendar).toHaveLength(1);
    expect(parsed.dropped.macroPolicy).toBeGreaterThan(0);
    expect(JSON.stringify(parsed)).not.toContain("\u0000");
  });
});

