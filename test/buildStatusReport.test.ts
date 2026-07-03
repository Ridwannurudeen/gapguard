import { describe, expect, it } from "vitest";
import {
  buildStatusReport,
  type GateHealth,
  type StatusFeed,
} from "../src/buildStatusReport";

const freshFeed: StatusFeed = {
  id: "rwa-market",
  label: "RWA market snapshot",
  path: "public/rwa-market.json",
  status: "fresh",
  generatedAt: "2026-07-03T00:00:00.000Z",
  ageMinutes: 4,
  maxAgeMinutes: 30,
};

const liveGate: GateHealth = {
  state: "live",
  reason: "gate key loaded",
  keyExpiresAt: null,
  verdicts: 3,
  retainedPreviousGood: false,
};

describe("buildStatusReport", () => {
  it("is healthy when every feed is fresh and the gate is live", () => {
    const report = buildStatusReport(
      [freshFeed, { ...freshFeed, id: "news-feed" }],
      liveGate,
      "2026-07-03T00:05:00.000Z",
    );
    expect(report.overall).toBe("healthy");
    expect(report.generatedAt).toBe("2026-07-03T00:05:00.000Z");
  });

  it("degrades when any feed is stale", () => {
    const report = buildStatusReport(
      [
        freshFeed,
        { ...freshFeed, id: "news-feed", status: "stale", ageMinutes: 90 },
      ],
      liveGate,
    );
    expect(report.overall).toBe("degraded");
  });

  it("degrades when the gate key is paused rather than live", () => {
    const report = buildStatusReport([freshFeed], {
      ...liveGate,
      state: "ai_paused",
    });
    expect(report.overall).toBe("degraded");
  });

  it("is down when a feed is missing or invalid", () => {
    const report = buildStatusReport(
      [
        {
          ...freshFeed,
          status: "missing",
          generatedAt: null,
          ageMinutes: null,
        },
      ],
      liveGate,
    );
    expect(report.overall).toBe("down");
  });

  it("treats an absent gate as neutral, not a failure", () => {
    const report = buildStatusReport([freshFeed], null);
    expect(report.overall).toBe("healthy");
    expect(report.gate).toBeNull();
  });
});
