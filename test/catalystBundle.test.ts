import { describe, expect, it } from "vitest";
import {
  buildCatalystBundle,
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
});
