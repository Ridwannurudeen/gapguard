import { describe, it, expect } from "vitest";
import { estimateDislocation } from "../src/dislocation";

describe("estimateDislocation", () => {
  it("flags a rich token at high sigma with full confidence", () => {
    const r = estimateDislocation({
      tokenPrice: 105,
      referencePrice: 100,
      volatility: 0.01,
    });
    expect(r.direction).toBe("rich");
    expect(r.zScore).toBeCloseTo(5, 6);
    expect(r.confidence).toBe(1);
  });

  it("flags a cheap token below fair value", () => {
    const r = estimateDislocation({
      tokenPrice: 98,
      referencePrice: 100,
      volatility: 0.005,
    });
    expect(r.direction).toBe("cheap");
    expect(r.zScore).toBeCloseTo(-4, 6);
    expect(r.confidence).toBe(1);
  });

  it("treats a sub-sigma gap as fair with zero confidence", () => {
    const r = estimateDislocation({
      tokenPrice: 100.2,
      referencePrice: 100,
      volatility: 0.01,
    });
    expect(r.direction).toBe("fair");
    expect(r.confidence).toBe(0);
  });

  it("shifts fair value by the off-hours proxy return", () => {
    const r = estimateDislocation({
      tokenPrice: 102,
      referencePrice: 100,
      proxyReturn: 0.02,
      volatility: 0.01,
    });
    expect(r.fairValue).toBeCloseTo(102, 6);
    expect(r.direction).toBe("fair");
  });

  it("logs premium/discount bps against a sourced point-in-time NAV reference", () => {
    const r = estimateDislocation({
      tokenPrice: 101,
      referencePrice: 99,
      decisionTimestamp: "2026-06-24T01:05:00.000Z",
      navReference: {
        price: 100,
        source: "Pyth off-hours equity NAV",
        asOf: "2026-06-24T01:00:00.000Z",
        maxAgeMs: 10 * 60_000,
      },
      volatility: 0.01,
    });

    expect(r.fairValue).toBeCloseTo(100, 6);
    expect(r.premiumDiscountBps).toBeCloseTo(100, 6);
    expect(r.reference?.source).toBe("Pyth off-hours equity NAV");
    expect(r.reference?.stale).toBe(false);
    expect(r.reference?.fallback).toBe(false);
  });

  it("marks a stale NAV/oracle reference without hiding the bps calculation", () => {
    const r = estimateDislocation({
      tokenPrice: 98,
      referencePrice: 100,
      decisionTimestamp: "2026-06-24T01:45:00.000Z",
      navReference: {
        price: 100,
        source: "RedStone Live equity NAV",
        asOf: "2026-06-24T01:00:00.000Z",
        maxAgeMs: 30 * 60_000,
      },
      volatility: 0.01,
    });

    expect(r.premiumDiscountBps).toBeCloseTo(-200, 6);
    expect(r.reference?.stale).toBe(true);
    expect(r.reference?.ageMs).toBe(45 * 60_000);
  });

  it("rejects NAV/oracle references from after the decision timestamp", () => {
    expect(() =>
      estimateDislocation({
        tokenPrice: 101,
        referencePrice: 100,
        decisionTimestamp: "2026-06-24T01:00:00.000Z",
        navReference: {
          price: 100,
          source: "Chainlink off-hours equity NAV",
          asOf: "2026-06-24T01:01:00.000Z",
          maxAgeMs: 30 * 60_000,
        },
        volatility: 0.01,
      }),
    ).toThrow(/after decision/);
  });

  it("labels legacy referencePrice as a fallback when no NAV/oracle is supplied", () => {
    const r = estimateDislocation({
      tokenPrice: 101,
      referencePrice: 100,
      volatility: 0.01,
    });

    expect(r.reference?.fallback).toBe(true);
    expect(r.reference?.label).toContain("fallback");
  });
});
