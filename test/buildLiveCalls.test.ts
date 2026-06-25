import { describe, expect, it } from "vitest";
import {
  chooseLiveCallsReport,
  resolveQwenKeyStatus,
  type LiveCallsReport,
} from "../src/buildLiveCalls";

function report(params: {
  generatedAt: string;
  attempts: number;
  failures: number;
  verdicts: number;
  gated?: boolean;
}): LiveCallsReport {
  const calls = Array.from({ length: Math.max(1, params.verdicts) }, (_, i) => ({
    symbol: `SYM${i}USDT`,
    ticker: `SYM${i}`,
    name: `Symbol ${i}`,
    gapBps: 50,
    lastPrice: 100,
    indexPrice: 99.5,
    spreadBps: 2,
    quoteVolumeUSDT: 10_000,
    fundingRate: 0,
    news: null,
    verdict:
      i < params.verdicts
        ? {
            action: "FADE" as const,
            fadeable: true,
            multiplier: 0.8,
            rationale: "noise",
          }
        : null,
    verdictNote: i < params.verdicts ? null : "gate unavailable",
  }));
  return {
    generatedAt: params.generatedAt,
    lastRefreshAttemptAt: params.generatedAt,
    gateModel: "qwen3.6-plus",
    notableBps: 40,
    gated: params.gated ?? true,
    gateStatus: {
      state: params.failures > 0 ? "degraded" : "live",
      reason: "test",
      keyExpiresAt: null,
      attempts: params.attempts,
      failures: params.failures,
      verdicts: params.verdicts,
      lastRefreshAttemptAt: params.generatedAt,
      retainedPreviousGood: false,
      previousGeneratedAt: null,
    },
    calls,
  };
}

describe("live calls hardening", () => {
  it("pauses the AI gate when the configured key expiry is in the past", () => {
    const status = resolveQwenKeyStatus(
      {
        BITGET_QWEN_API_KEY: "secret",
        BITGET_QWEN_KEY_EXPIRES_AT: "2026-06-30T00:00:00.000Z",
      },
      new Date("2026-07-01T00:00:00.000Z"),
    );

    expect(status).toMatchObject({
      apiKey: null,
      state: "expired",
      expiresAt: "2026-06-30T00:00:00.000Z",
    });
    expect(status.reason).toContain("expired");
  });

  it("retains a fresh previous report when a keyed refresh degrades", () => {
    const previous = report({
      generatedAt: "2026-06-25T00:00:00.000Z",
      attempts: 1,
      failures: 0,
      verdicts: 2,
    });
    const candidate = report({
      generatedAt: "2026-06-25T00:30:00.000Z",
      attempts: 2,
      failures: 2,
      verdicts: 0,
    });

    const selected = chooseLiveCallsReport(candidate, previous, {
      now: new Date("2026-06-25T00:30:00.000Z"),
      maxRetainMs: 2 * 60 * 60_000,
    });

    expect(selected.generatedAt).toBe(previous.generatedAt);
    expect(selected.lastRefreshAttemptAt).toBe(candidate.lastRefreshAttemptAt);
    expect(selected.gateStatus).toMatchObject({
      state: "retained_previous_good",
      retainedPreviousGood: true,
      previousGeneratedAt: previous.generatedAt,
      verdicts: 2,
    });
  });

  it("does not retain stale previous verdicts", () => {
    const previous = report({
      generatedAt: "2026-06-24T00:00:00.000Z",
      attempts: 1,
      failures: 0,
      verdicts: 2,
    });
    const candidate = report({
      generatedAt: "2026-06-25T00:30:00.000Z",
      attempts: 2,
      failures: 2,
      verdicts: 0,
    });

    const selected = chooseLiveCallsReport(candidate, previous, {
      now: new Date("2026-06-25T00:30:00.000Z"),
      maxRetainMs: 2 * 60 * 60_000,
    });

    expect(selected.generatedAt).toBe(candidate.generatedAt);
    expect(selected.gateStatus.state).toBe("degraded");
  });
});
