import { describe, expect, it } from "vitest";
import {
  buildCatalystBundle,
  buildOffHoursSignalItems,
} from "../src/catalystBundle";
import { buildMessages } from "../src/convergenceGate";
import { estimateDislocation } from "../src/dislocation";
import { estimateOffHoursLiquidity } from "../src/proxyReturn";

describe("T2-F off-hours signal gate context", () => {
  it("carries NAV premium bps, oracle freshness, and liquidity depth into the gate prompt", () => {
    const dislocation = estimateDislocation({
      tokenPrice: 101,
      referencePrice: 100,
      decisionTimestamp: "2026-06-24T13:05:00.000Z",
      navReference: {
        price: 100,
        source: "Pyth off-hours equity NAV",
        asOf: "2026-06-24T13:00:00.000Z",
        maxAgeMs: 10 * 60_000,
      },
      volatility: 0.01,
    });
    const liquidity = estimateOffHoursLiquidity({
      source: "Bitget public order book",
      asOf: "2026-06-24T13:00:00.000Z",
      decisionTimestamp: "2026-06-24T13:05:00.000Z",
      spreadBps: 80,
      offHoursVolume: 100,
      typicalOffHoursVolume: 10_000,
    });

    const baseBundle = buildCatalystBundle({
      asset: "AAPLUSDT",
      date: "2026-06-24",
      decisionTimestamp: "2026-06-24T13:05:00.000Z",
      newsSummary: "No company-news headlines before the decision timestamp.",
    });
    const catalystBundle = {
      ...baseBundle,
      crossAsset: [
        ...baseBundle.crossAsset,
        ...buildOffHoursSignalItems({
          decisionTimestamp: baseBundle.decisionTimestamp,
          premiumDiscountBps: dislocation.premiumDiscountBps,
          reference: dislocation.reference,
          liquidity,
        }),
      ],
    };

    const messages = buildMessages({
      symbol: "AAPLUSDT",
      direction: dislocation.direction === "cheap" ? "cheap" : "rich",
      dislocationPct: dislocation.dislocationPct,
      sessionLabel: "overnight (US stock off-hours)",
      newsSummary: "No company-news headlines before the decision timestamp.",
      catalystBundle,
    });

    const user = messages[1].content;
    expect(user).toContain("[nav-oracle-2026-06-24]");
    expect(user).toContain("NAV_ORACLE premiumDiscountBps=100.0");
    expect(user).toContain("Pyth off-hours equity NAV");
    expect(user).toContain("freshness=fresh");
    expect(user).toContain("[off-hours-liquidity-2026-06-24]");
    expect(user).toContain("Bitget public order book");
    expect(user).toContain("depth=thin");
    expect(user).toContain("gateBias=fade_noise");
  });

  it("rejects off-hours signal catalyst items from after the decision timestamp", () => {
    const liquidity = estimateOffHoursLiquidity({
      source: "Bitget public order book",
      asOf: "2026-06-24T01:06:00.000Z",
      spreadBps: 80,
      offHoursVolume: 100,
      typicalOffHoursVolume: 10_000,
    });

    expect(() =>
      buildOffHoursSignalItems({
        decisionTimestamp: "2026-06-24T01:05:00.000Z",
        liquidity,
      }),
    ).toThrow(/not before decision/);
  });
});
