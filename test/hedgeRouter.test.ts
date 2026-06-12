import { describe, it, expect } from "vitest";
import { routeExecution } from "../src/hedgeRouter";
import { instrumentsFor } from "../src/instruments";
import type { RiskDecision } from "../src/riskGovernor";

const decision = (targetNotional: number): RiskDecision => ({
  action:
    targetNotional < 0
      ? "enter_short"
      : targetNotional > 0
        ? "enter_long"
        : "flatten",
  targetNotional,
  reason: "",
});

describe("instrumentsFor", () => {
  it("maps a tokenized symbol to the spot token and the matching stock perp", () => {
    const { token, perp } = instrumentsFor("TSLAx");
    expect(token).toMatchObject({
      symbol: "TSLAx",
      venue: "onchain-spot",
      canShort: false,
    });
    expect(perp).toMatchObject({
      symbol: "TSLAUSDT",
      venue: "usdt-futures",
      canShort: true,
      productType: "USDT-FUTURES",
    });
  });
});

describe("routeExecution", () => {
  it("routes a short to the perp — the token can never carry a short", () => {
    const plan = routeExecution(decision(-1500), "TSLAx", false, 0);
    expect(plan.instrument.symbol).toBe("TSLAUSDT");
    expect(plan.instrument.venue).toBe("usdt-futures");
    expect(plan.side).toBe("sell");
    expect(plan.notional).toBe(1500);
    expect(plan.hedged).toBe(true);
    expect(plan.instrument.canShort).toBe(true);
  });

  it("rests a long on the spot token, unhedged", () => {
    const plan = routeExecution(decision(1500), "TSLAx", false, 0);
    expect(plan.instrument.symbol).toBe("TSLAx");
    expect(plan.instrument.venue).toBe("onchain-spot");
    expect(plan.side).toBe("buy");
    expect(plan.hedged).toBe(false);
  });

  it("flags the closure caveat only when opening a perp while the underlying is closed", () => {
    expect(
      routeExecution(decision(-1500), "TSLAx", false, 0).closureCaveat,
    ).toBe(true);
    expect(
      routeExecution(decision(-1500), "TSLAx", true, 0).closureCaveat,
    ).toBe(false);
  });

  it("closes a carried hedge on the perp when flattening a short", () => {
    const plan = routeExecution(decision(0), "TSLAx", true, -1996);
    expect(plan.instrument.symbol).toBe("TSLAUSDT");
    expect(plan.side).toBe("buy"); // buy-to-close the short
    expect(plan.notional).toBe(1996);
    expect(plan.hedged).toBe(true);
  });

  it("sells the spot token when flattening a long, and reports flat when nothing is held", () => {
    expect(routeExecution(decision(0), "TSLAx", true, 1200)).toMatchObject({
      instrument: { symbol: "TSLAx", venue: "onchain-spot" },
      side: "sell",
      notional: 1200,
    });
    expect(routeExecution(decision(0), "TSLAx", true, 0)).toMatchObject({
      side: "flat",
      notional: 0,
    });
  });
});
