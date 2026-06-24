import { describe, it, expect } from "vitest";
import {
  estimateOffHoursLiquidity,
  estimateProxyReturn,
  type ProxySignal,
} from "../src/proxyReturn";

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

describe("estimateOffHoursLiquidity", () => {
  it("classifies wide-spread low-volume books as fadeable noise context", () => {
    const signal = estimateOffHoursLiquidity({
      source: "Bitget public order book",
      asOf: "2026-06-24T01:00:00.000Z",
      decisionTimestamp: "2026-06-24T01:01:00.000Z",
      bidPrice: 99,
      askPrice: 101,
      offHoursVolume: 100,
      typicalOffHoursVolume: 10_000,
    });

    expect(signal.spreadBps).toBeCloseTo(200, 6);
    expect(signal.volumeRatio).toBeCloseTo(0.01, 6);
    expect(signal.depth).toBe("thin");
    expect(signal.gateBias).toBe("fade_noise");
    expect(signal.reason).toContain("fadeable noise");
  });

  it("classifies tight high-volume books as real repricing context", () => {
    const signal = estimateOffHoursLiquidity({
      source: "Bitget public order book",
      asOf: "2026-06-24T01:00:00.000Z",
      decisionTimestamp: "2026-06-24T01:01:00.000Z",
      spreadBps: 4,
      offHoursVolume: 3_000,
      typicalOffHoursVolume: 1_000,
    });

    expect(signal.depth).toBe("deep");
    expect(signal.gateBias).toBe("stand_aside");
    expect(signal.reason).toContain("real repricing");
  });

  it("rejects liquidity observations from after the decision timestamp", () => {
    expect(() =>
      estimateOffHoursLiquidity({
        source: "Bitget public order book",
        asOf: "2026-06-24T01:02:00.000Z",
        decisionTimestamp: "2026-06-24T01:01:00.000Z",
        spreadBps: 4,
        offHoursVolume: 3_000,
        typicalOffHoursVolume: 1_000,
      }),
    ).toThrow(/after decision/);
  });

  it("labels fallback liquidity explicitly", () => {
    const signal = estimateOffHoursLiquidity({
      source: "committed execution-assumption fallback",
      asOf: "2026-06-24T01:00:00.000Z",
      offHoursVolume: 0,
      fallback: true,
    });

    expect(signal.fallback).toBe(true);
    expect(signal.reason).toContain("fallback labeled");
  });
});
