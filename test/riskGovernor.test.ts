import { describe, it, expect } from "vitest";
import {
  governRisk,
  DEFAULT_RISK_CONFIG,
  type RiskInput,
} from "../src/riskGovernor";

const base: RiskInput = {
  direction: "rich",
  confidence: 1,
  volatility: 0.02,
  session: "overnight",
  underlyingOpen: false,
  equity: 10_000,
  currentExposure: 0,
  drawdownPct: 0,
};

describe("governRisk", () => {
  it("trips the circuit breaker and flattens on excess drawdown", () => {
    const d = governRisk({ ...base, currentExposure: 1500, drawdownPct: 0.12 });
    expect(d.action).toBe("flatten");
    expect(d.targetNotional).toBe(0);
  });

  it("shorts a rich token off-hours, capped by the off-hours limit", () => {
    const d = governRisk(base);
    // raw = 10000*0.01*1/0.02 = 5000, capped to 0.2*10000 = 2000
    expect(d.action).toBe("enter_short");
    expect(d.targetNotional).toBe(-2000);
  });

  it("goes long a cheap token off-hours", () => {
    const d = governRisk({ ...base, direction: "cheap" });
    expect(d.action).toBe("enter_long");
    expect(d.targetNotional).toBe(2000);
  });

  it("realizes convergence by flattening once the underlying reopens", () => {
    const d = governRisk({
      ...base,
      session: "regular",
      underlyingOpen: true,
      currentExposure: -2000,
    });
    expect(d.action).toBe("flatten");
    expect(d.targetNotional).toBe(0);
  });

  it("holds flat when the gap is within the deadband", () => {
    const d = governRisk({ ...base, direction: "fair" });
    expect(d.action).toBe("hold");
    expect(d.targetNotional).toBe(0);
  });

  it("uses the wider cap during regular hours", () => {
    const d = governRisk(
      { ...base, underlyingOpen: false, session: "pre", confidence: 1 },
      { ...DEFAULT_RISK_CONFIG, forceFlatBeforeOpen: true },
    );
    expect(Math.abs(d.targetNotional)).toBe(2000);
  });
});
