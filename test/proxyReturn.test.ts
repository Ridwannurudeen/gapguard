import { describe, it, expect } from "vitest";
import { estimateProxyReturn, type ProxySignal } from "../src/proxyReturn";

describe("estimateProxyReturn", () => {
  it("returns a neutral estimate when no signals are active", () => {
    const e = estimateProxyReturn([
      { name: "NQ", return: 0.02, beta: 1, weight: 0 },
    ]);
    expect(e).toEqual({ proxyReturn: 0, confidence: 0, contributors: 0 });
  });

  it("scales a single signal by its beta", () => {
    const e = estimateProxyReturn([
      { name: "NQ", return: 0.02, beta: 1.5, weight: 1 },
    ]);
    expect(e.proxyReturn).toBeCloseTo(0.03, 6);
    expect(e.contributors).toBe(1);
  });

  it("weight-averages agreeing signals with high confidence", () => {
    const signals: ProxySignal[] = [
      { name: "NQ", return: 0.02, beta: 1, weight: 1 }, // implied +0.02
      { name: "XLK", return: 0.04, beta: 0.5, weight: 1 }, // implied +0.02
    ];
    const e = estimateProxyReturn(signals);
    expect(e.proxyReturn).toBeCloseTo(0.02, 6);
    expect(e.confidence).toBeCloseTo(1, 6); // full coverage, zero dispersion
  });

  it("discounts confidence when signals disagree", () => {
    const agree = estimateProxyReturn([
      { name: "a", return: 0.02, beta: 1, weight: 1 },
      { name: "b", return: 0.02, beta: 1, weight: 1 },
    ]);
    const conflict = estimateProxyReturn([
      { name: "a", return: 0.04, beta: 1, weight: 1 },
      { name: "b", return: -0.04, beta: 1, weight: 1 }, // opposite implied return
    ]);
    expect(conflict.confidence).toBeLessThan(agree.confidence);
    expect(conflict.proxyReturn).toBeCloseTo(0, 6);
  });
});
