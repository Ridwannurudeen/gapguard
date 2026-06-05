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
});
