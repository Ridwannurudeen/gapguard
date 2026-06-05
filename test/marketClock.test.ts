import { describe, it, expect } from "vitest";
import { classifySession } from "../src/marketClock";

// 2026 DST: EDT (UTC−4) Mar 8 – Nov 1, otherwise EST (UTC−5).
describe("classifySession", () => {
  it("regular session midday (Fri 10:00 ET)", () => {
    const s = classifySession(new Date("2026-06-05T14:00:00Z"));
    expect(s.session).toBe("regular");
    expect(s.underlyingOpen).toBe(true);
  });

  it("overnight after post-market (Thu 22:00 ET)", () => {
    const s = classifySession(new Date("2026-06-05T02:00:00Z"));
    expect(s.session).toBe("overnight");
    expect(s.underlyingOpen).toBe(false);
    expect(s.nextOpenUtc).toBe("2026-06-05T13:30:00.000Z");
  });

  it("weekend rolls next open to Monday 9:30 ET", () => {
    const s = classifySession(new Date("2026-06-06T16:00:00Z"));
    expect(s.session).toBe("weekend");
    expect(s.underlyingOpen).toBe(false);
    expect(s.nextOpenUtc).toBe("2026-06-08T13:30:00.000Z");
  });

  it("full closure (Independence Day observed Jul 3)", () => {
    const s = classifySession(new Date("2026-07-03T15:00:00Z"));
    expect(s.session).toBe("holiday");
    expect(s.underlyingOpen).toBe(false);
  });

  it("early-close day is closed after 1pm ET (Black Friday 13:30 ET)", () => {
    const s = classifySession(new Date("2026-11-27T18:30:00Z"));
    expect(s.session).toBe("post");
    expect(s.underlyingOpen).toBe(false);
  });

  it("regular session next open rolls past the weekend", () => {
    const s = classifySession(new Date("2026-06-05T14:00:00Z"));
    expect(s.nextOpenUtc).toBe("2026-06-08T13:30:00.000Z");
    expect(s.msToNextOpen).toBeGreaterThan(0);
  });
});
