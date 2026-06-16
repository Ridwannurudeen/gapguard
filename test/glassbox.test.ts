import { describe, expect, it } from "vitest";
import {
  GENESIS_HASH,
  GlassBox,
  hashDecision,
  type DecisionInput,
} from "../src/glassbox";

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

describe("GlassBox", () => {
  it("hash-chains decision records", () => {
    const lines: string[] = [];
    const gb = new GlassBox((line) => lines.push(line));

    const first = gb.record(decision);
    const second = gb.record({ ...decision, ts: "2026-06-08T12:00:00Z" });

    expect(first.prevHash).toBe(GENESIS_HASH);
    expect(first.hash).toBe(
      hashDecision({ ...decision, prevHash: GENESIS_HASH }),
    );
    expect(second.prevHash).toBe(first.hash);
    expect(lines.map((line) => JSON.parse(line).hash)).toEqual([
      first.hash,
      second.hash,
    ]);
  });
});
