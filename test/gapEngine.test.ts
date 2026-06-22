import { describe, expect, it } from "vitest";
import {
  collapseSessions,
  computeGapTrades,
  summarize,
  type Candle,
} from "../src/gapEngine";

// Two synthetic regular-session days a weekday apart (12:00 UTC = ~08:00 ET, in
// the regular session). Prior close 100 -> next open 102 = a +2% up gap to fade short.
function bar(ts: number, open: number, close: number): Candle {
  return {
    ts,
    open,
    high: Math.max(open, close),
    low: Math.min(open, close),
    close,
    volume: 1,
  };
}
const dayA = Date.UTC(2026, 4, 12, 16, 0, 0); // Tue ~12:00 ET (regular session)
const dayB = Date.UTC(2026, 4, 13, 16, 0, 0); // Wed ~12:00 ET

describe("gapEngine", () => {
  it("collapses bars into one session per day", () => {
    const sessions = collapseSessions([
      bar(dayA, 100, 100),
      bar(dayB, 102, 101),
    ]);
    expect(sessions).toHaveLength(2);
    expect(sessions[0].closePrice).toBe(100);
    expect(sessions[1].openPrice).toBe(102);
  });

  it("fades an outsized gap and a skip predicate stands the agent aside", () => {
    const sessions = collapseSessions([
      bar(dayA, 100, 100),
      bar(dayB, 102, 101),
    ]);
    const opts = {
      gapThreshold: 0.004,
      costPerSide: 0.0005,
      startEquity: 1000,
    };

    const faded = computeGapTrades("AAPLUSDT", sessions, opts);
    expect(faded).toHaveLength(1);
    expect(faded[0].direction).toBe("short"); // +2% up gap -> fade short

    const stoodAside = computeGapTrades("AAPLUSDT", sessions, {
      ...opts,
      skip: (date) => date === sessions[1].date,
    });
    expect(stoodAside).toHaveLength(0);
    expect(summarize(stoodAside, sessions, 1000).totalReturnPct).toBe(0);
  });
});
