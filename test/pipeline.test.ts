import { describe, it, expect } from "vitest";
import { GlassBox } from "../src/glassbox";
import { decide, type MarketTick, type Portfolio } from "../src/pipeline";

const flat: Portfolio = { equity: 10_000, exposure: 0, drawdownPct: 0 };

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
});
