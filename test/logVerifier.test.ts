import { describe, expect, it } from "vitest";
import { GlassBox, formatRecord, type DecisionInput } from "../src/glassbox";
import {
  parseJsonlRecords,
  verifyJsonl,
  verifyRecords,
} from "../src/logVerifier";

const decision: DecisionInput = {
  ts: "2026-06-07T18:00:00Z",
  symbol: "TSLAx",
  session: {
    session: "weekend",
    underlyingOpen: false,
    etTime: "2026-06-07 14:00 ET",
    nextOpenUtc: "2026-06-08T13:30:00.000Z",
    msToNextOpen: 70_200_000,
  },
  market: {
    tokenPrice: 103,
    referencePrice: 100,
    proxyReturn: 0,
  },
  dislocation: {
    fairValue: 100,
    dislocationPct: 0.03,
    zScore: 2,
    direction: "rich",
    confidence: 0.5,
  },
  risk: {
    action: "enter_short",
    targetNotional: -1_000,
    reason: "Short convergence",
  },
};

describe("logVerifier", () => {
  it("validates a glass-box hash chain", () => {
    const gb = new GlassBox();
    gb.record(decision);
    gb.record({ ...decision, ts: "2026-06-08T12:00:00Z" });

    const result = verifyRecords(gb.all());
    expect(result.ok).toBe(true);
    expect(result.count).toBe(2);
    expect(result.errors).toEqual([]);
  });

  it("detects tampered records", () => {
    const gb = new GlassBox();
    const record = gb.record(decision);
    const tampered = {
      ...record,
      market: { ...record.market, tokenPrice: 104 },
    };

    const result = verifyRecords([tampered]);
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain("hash");
  });

  it("parses JSONL before verification", () => {
    const gb = new GlassBox();
    const first = gb.record(decision);
    const jsonl = `${formatRecord(first)}\n`;

    expect(parseJsonlRecords(jsonl)).toHaveLength(1);
    expect(verifyJsonl(jsonl).ok).toBe(true);
  });
});
