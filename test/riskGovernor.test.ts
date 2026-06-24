import { describe, it, expect } from "vitest";
import {
  governRisk,
  DEFAULT_RISK_CONFIG,
  type RiskInput,
} from "../src/riskGovernor";
import { estimateDislocation } from "../src/dislocation";
import { estimateOffHoursLiquidity } from "../src/proxyReturn";

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

  it("adds to a same-side short when the target grows beyond the rebalance band", () => {
    const d = governRisk({ ...base, currentExposure: -1111 });
    expect(d.action).toBe("enter_short");
    expect(d.targetNotional).toBe(-2000);
  });

  it("holds within the rebalance band and keeps the current position", () => {
    const d = governRisk({ ...base, currentExposure: -1999 });
    expect(d.action).toBe("hold");
    expect(d.targetNotional).toBe(-1999);
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

  it("refuses to enter against a stale NAV/oracle reference", () => {
    const dislocation = estimateDislocation({
      tokenPrice: 105,
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
    const d = governRisk({
      ...base,
      direction: dislocation.direction,
      confidence: dislocation.confidence,
      reference: dislocation.reference,
    });

    expect(d.action).toBe("hold");
    expect(d.targetNotional).toBe(0);
    expect(d.reason).toContain("Stale NAV/oracle reference");
    expect(d.reason).toContain("refusing trade");
  });

  it("flattens existing exposure when the NAV/oracle reference goes stale", () => {
    const dislocation = estimateDislocation({
      tokenPrice: 95,
      referencePrice: 100,
      decisionTimestamp: "2026-06-24T01:45:00.000Z",
      navReference: {
        price: 100,
        source: "Pyth off-hours equity NAV",
        asOf: "2026-06-24T01:00:00.000Z",
        maxAgeMs: 30 * 60_000,
      },
      volatility: 0.01,
    });
    const d = governRisk({
      ...base,
      direction: dislocation.direction,
      currentExposure: 1_000,
      reference: dislocation.reference,
    });

    expect(d.action).toBe("flatten");
    expect(d.targetNotional).toBe(0);
  });

  it("keeps thin off-hours liquidity as fade context rather than a stale-data block", () => {
    const liquidity = estimateOffHoursLiquidity({
      source: "Bitget public order book",
      asOf: "2026-06-24T01:00:00.000Z",
      decisionTimestamp: "2026-06-24T01:01:00.000Z",
      spreadBps: 80,
      offHoursVolume: 100,
      typicalOffHoursVolume: 10_000,
    });
    const d = governRisk({ ...base, liquidity });

    expect(d.action).toBe("enter_short");
    expect(d.targetNotional).toBe(-2000);
    expect(d.reason).toContain("fadeable noise context");
  });

  it("stands aside when deep off-hours liquidity suggests real repricing", () => {
    const liquidity = estimateOffHoursLiquidity({
      source: "Bitget public order book",
      asOf: "2026-06-24T01:00:00.000Z",
      decisionTimestamp: "2026-06-24T01:01:00.000Z",
      spreadBps: 4,
      offHoursVolume: 3_000,
      typicalOffHoursVolume: 1_000,
    });
    const d = governRisk({ ...base, liquidity });

    expect(d.action).toBe("hold");
    expect(d.targetNotional).toBe(0);
    expect(d.reason).toContain("real repricing");
  });
});
