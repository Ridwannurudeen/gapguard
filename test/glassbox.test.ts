import { describe, it, expect } from "vitest";
import { GlassBox, GENESIS } from "../src/glassbox";
import { decide, type MarketTick, type Portfolio } from "../src/pipeline";

const flat: Portfolio = { equity: 10_000, exposure: 0, drawdownPct: 0 };

const ticks: MarketTick[] = [
  {
    ts: "2026-06-06T18:00:00Z",
    symbol: "TSLAx",
    tokenPrice: 102,
    referencePrice: 100,
    volatility: 0.015,
  },
  {
    ts: "2026-06-07T18:00:00Z",
    symbol: "TSLAx",
    tokenPrice: 103.5,
    referencePrice: 100,
    volatility: 0.015,
  },
  {
    ts: "2026-06-08T13:35:00Z",
    symbol: "TSLAx",
    tokenPrice: 100.4,
    referencePrice: 100,
    volatility: 0.015,
  },
];

function logRun(): GlassBox {
  const gb = new GlassBox();
  for (const tick of ticks) decide(tick, flat, gb);
  return gb;
}

describe("GlassBox hash chain", () => {
  it("anchors the first record to GENESIS and links each to the previous recordHash", () => {
    const recs = logRun().all();
    expect(recs[0].prevHash).toBe(GENESIS);
    expect(recs[0].recordHash).toMatch(/^[0-9a-f]{64}$/);
    for (let i = 1; i < recs.length; i++) {
      expect(recs[i].prevHash).toBe(recs[i - 1].recordHash);
    }
  });

  it("verifies an untouched chain", () => {
    expect(logRun().verifyChain()).toBe(true);
  });

  it("detects tampering with a past record", () => {
    const gb = logRun();
    gb.all()[1].risk.targetNotional += 1; // mutate a sealed payload field
    expect(gb.verifyChain()).toBe(false);
  });
});
