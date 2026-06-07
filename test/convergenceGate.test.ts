import { describe, it, expect } from "vitest";
import {
  buildMessages,
  parseVerdict,
  assessConvergence,
  effectiveMultiplier,
  type GateContext,
} from "../src/convergenceGate";

const ctx: GateContext = {
  symbol: "TSLAx",
  direction: "rich",
  dislocationPct: 0.035,
  sessionLabel: "weekend",
  newsSummary: "Quiet weekend, no company news.",
};

describe("convergenceGate", () => {
  it("builds a system+user message pair carrying the context", () => {
    const msgs = buildMessages(ctx);
    expect(msgs).toHaveLength(2);
    expect(msgs[0].role).toBe("system");
    expect(msgs[1].content).toContain("TSLAx");
    expect(msgs[1].content).toContain("3.50%");
  });

  it("parses a clean JSON verdict", () => {
    const v = parseVerdict(
      '{"fadeable": true, "confidenceMultiplier": 0.8, "rationale": "noise"}',
    );
    expect(v).toEqual({
      fadeable: true,
      confidenceMultiplier: 0.8,
      rationale: "noise",
    });
  });

  it("extracts JSON even when wrapped in prose and clamps the multiplier", () => {
    const v = parseVerdict(
      'Here is my call: {"fadeable": false, "confidenceMultiplier": 1.7, "rationale": "real news"} done',
    );
    expect(v.fadeable).toBe(false);
    expect(v.confidenceMultiplier).toBe(1);
  });

  it("throws when the response has no JSON", () => {
    expect(() => parseVerdict("I cannot answer")).toThrow();
  });

  it("zeroes the effective multiplier when the gap is not fadeable, ignoring the model's number", () => {
    expect(
      effectiveMultiplier({
        fadeable: false,
        confidenceMultiplier: 0.95,
        rationale: "real news",
      }),
    ).toBe(0);
    expect(
      effectiveMultiplier({
        fadeable: true,
        confidenceMultiplier: 0.85,
        rationale: "noise",
      }),
    ).toBe(0.85);
  });

  it("assessConvergence routes through the injected chat function", async () => {
    const stub = async () =>
      '{"fadeable": false, "confidenceMultiplier": 0.1, "rationale": "earnings beat"}';
    const v = await assessConvergence(ctx, stub);
    expect(v.fadeable).toBe(false);
    expect(v.confidenceMultiplier).toBeCloseTo(0.1, 6);
  });
});
