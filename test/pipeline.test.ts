import { describe, it, expect } from "vitest";
import { GlassBox } from "../src/glassbox";
import { decide, type MarketTick, type Portfolio } from "../src/pipeline";
import { DEFAULT_RISK_CONFIG } from "../src/riskGovernor";

const flat: Portfolio = { equity: 10_000, exposure: 0, drawdownPct: 0 };

const richWeekend: MarketTick = {
  ts: "2026-06-07T18:00:00Z", // Sunday — market closed
  symbol: "TSLAx",
  tokenPrice: 103.5,
  referencePrice: 100,
  volatility: 0.015,
};

describe("decide (full pipeline)", () => {
  it("shorts a rich token over the weekend and logs the decision", () => {
    const gb = new GlassBox();
    const tick: MarketTick = {
      ts: "2026-06-07T18:00:00Z", // Sunday — market closed
      symbol: "TSLAx",
      tokenPrice: 103.5,
      referencePrice: 100,
      volatility: 0.015,
    };
    const rec = decide(tick, flat, gb);
    expect(rec.session.session).toBe("weekend");
    expect(rec.dislocation.direction).toBe("rich");
    expect(rec.risk.action).toBe("enter_short");
    expect(rec.risk.targetNotional).toBeLessThan(0);
    expect(gb.all()).toHaveLength(1);
  });

  it("flattens an open short once the underlying reopens", () => {
    const gb = new GlassBox();
    const tick: MarketTick = {
      ts: "2026-06-08T13:35:00Z", // Monday 09:35 ET — regular session
      symbol: "TSLAx",
      tokenPrice: 100.4,
      referencePrice: 100,
      volatility: 0.015,
    };
    const rec = decide(tick, { ...flat, exposure: -2000 }, gb);
    expect(rec.session.underlyingOpen).toBe(true);
    expect(rec.risk.action).toBe("flatten");
    expect(rec.risk.targetNotional).toBe(0);
  });

  it("uses proxy signals to lift fair value, so a 'rich' raw gap reads as fair", () => {
    const gb = new GlassBox();
    const tick: MarketTick = {
      ts: "2026-06-07T18:00:00Z", // Sunday — market closed
      symbol: "TSLAx",
      tokenPrice: 103,
      referencePrice: 100, // raw gap = +3% (would look rich)
      // Two fully-trusted, agreeing signals → confidence 1, so the +3% blend lifts fair value fully.
      proxySignals: [
        { name: "NQ", return: 0.03, beta: 1, weight: 1 },
        { name: "ES", return: 0.03, beta: 1, weight: 1 },
      ],
      volatility: 0.015,
    };
    const rec = decide(tick, flat, gb);
    expect(rec.dislocation.fairValue).toBeCloseTo(103, 6);
    expect(rec.dislocation.direction).toBe("fair");
    expect(rec.risk.action).toBe("hold");
  });

  it("dampens fair value by proxy confidence: a weak blend moves it less than a trusted one", () => {
    const gb = new GlassBox();
    const base = {
      ts: "2026-06-07T18:00:00Z", // Sunday — market closed
      symbol: "TSLAx",
      tokenPrice: 103,
      referencePrice: 100,
      volatility: 0.015,
    } as const;
    // Same raw blended proxyReturn (+3%), different confidence via coverage (total weight 1 vs 2).
    const weak = decide(
      {
        ...base,
        proxySignals: [{ name: "NQ", return: 0.03, beta: 1, weight: 1 }],
      },
      flat,
      gb,
    );
    const trusted = decide(
      {
        ...base,
        proxySignals: [
          { name: "NQ", return: 0.03, beta: 1, weight: 1 },
          { name: "ES", return: 0.03, beta: 1, weight: 1 },
        ],
      },
      flat,
      gb,
    );
    expect(weak.dislocation.fairValue).toBeLessThan(
      trusted.dislocation.fairValue,
    );
    expect(trusted.dislocation.fairValue).toBeCloseTo(103, 6); // confidence 1 → full lift
    expect(weak.dislocation.fairValue).toBeCloseTo(101.5, 6); // confidence 0.5 → half lift
  });

  it("a non-fadeable gate (multiplier 0) vetoes the trade and is recorded", () => {
    const gb = new GlassBox();
    const rec = decide(richWeekend, flat, gb, DEFAULT_RISK_CONFIG, {
      multiplier: 0,
      rationale: "earnings beat — justified repricing",
    });
    expect(rec.dislocation.direction).toBe("rich"); // raw signal unchanged
    expect(rec.risk.action).toBe("hold"); // but conviction gated to zero → no trade
    expect(rec.gate?.multiplier).toBe(0);
  });

  it("a fadeable gate (multiplier 1) leaves the convergence trade intact", () => {
    const gb = new GlassBox();
    const rec = decide(richWeekend, flat, gb, DEFAULT_RISK_CONFIG, {
      multiplier: 1,
    });
    expect(rec.risk.action).toBe("enter_short");
    expect(rec.risk.targetNotional).toBeLessThan(0);
  });
});
