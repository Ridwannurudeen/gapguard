import { describe, expect, it } from "vitest";
import type { Candle } from "../src/gapEngine";
import type { ChatFn } from "../src/convergenceGate";
import {
  buildGateHoldoutReport,
  buildHoldoutCandidates,
  type HoldoutCandidate,
} from "../src/gateHoldoutReport";
import {
  buildHoldoutGateContext,
  scoreHoldoutCandidates,
} from "../src/holdoutGateScoring";
import {
  holdoutVerdictMap,
  parseHoldoutGateCache,
} from "../src/holdoutGateCache";

const candidates: HoldoutCandidate[] = [
  {
    symbol: "AAPLUSDT",
    date: "2026-06-03",
    gapPct: 2,
    fadeReturnPct: 1,
    followReturnPct: -1,
    oracleAction: "FADE",
  },
  {
    symbol: "NVDAUSDT",
    date: "2026-06-03",
    gapPct: -1.5,
    fadeReturnPct: -1,
    followReturnPct: 1,
    oracleAction: "FOLLOW",
  },
];

function session(day: number, open: number, close: number): Candle {
  return {
    ts: Date.UTC(2026, 5, day, 16, 0, 0),
    open,
    high: Math.max(open, close),
    low: Math.min(open, close),
    close,
    volume: 1,
  };
}

describe("holdout gate scoring", () => {
  it("maps a gap candidate to a gate context with the macro bundle", () => {
    const rich = buildHoldoutGateContext(candidates[0], "");
    expect(rich.direction).toBe("rich");
    expect(rich.dislocationPct).toBeCloseTo(0.02);
    expect(rich.catalystBundle?.scheduledMacro.length).toBeGreaterThan(0);

    const cheap = buildHoldoutGateContext(candidates[1], "");
    expect(cheap.direction).toBe("cheap");
  });

  it("records the model action and effective multiplier", async () => {
    const fadeChat: ChatFn = async () =>
      '{"action":"FADE","confidenceMultiplier":0.8,"evidenceIds":["macro-x"],"rationale":"noise"}';
    const verdicts = await scoreHoldoutCandidates({
      candidates,
      news: new Map(),
      chat: fadeChat,
    });
    expect(verdicts).toHaveLength(2);
    expect(verdicts[0]).toMatchObject({
      symbol: "AAPLUSDT",
      date: "2026-06-03",
      action: "FADE",
      hasCompanyNews: false,
    });
    expect(verdicts[0].multiplier).toBeCloseTo(0.8);
  });

  it("fails closed to STAND_ASIDE on malformed model output", async () => {
    const badChat: ChatFn = async () => "no json here at all";
    const [verdict] = await scoreHoldoutCandidates({
      candidates: candidates.slice(0, 1),
      news: new Map(),
      chat: badChat,
    });
    expect(verdict.action).toBe("STAND_ASIDE");
    expect(verdict.parseError).toBeTruthy();
  });

  it("fails closed to STAND_ASIDE when the transport throws", async () => {
    const throwChat: ChatFn = async () => {
      throw new Error("boom");
    };
    const [verdict] = await scoreHoldoutCandidates({
      candidates: candidates.slice(0, 1),
      news: new Map(),
      chat: throwChat,
    });
    expect(verdict.action).toBe("STAND_ASIDE");
    expect(verdict.parseError).toContain("boom");
  });

  it("round-trips a verdict cache into a predictor map", () => {
    const cache = parseHoldoutGateCache(
      {
        generatedAt: "2026-06-23T00:00:00.000Z",
        model: "qwen3.6-plus",
        symbols: ["AAPLUSDT"],
        newsSource: "none",
        verdicts: [
          {
            symbol: "AAPLUSDT",
            date: "2026-06-03",
            action: "FADE",
            multiplier: 0.5,
            evidenceIds: [],
            rationale: "r",
            hasCompanyNews: true,
          },
        ],
      },
      "$",
    );
    expect(holdoutVerdictMap(cache).get("AAPLUSDT|2026-06-03")).toBe("FADE");
  });

  it("marks the full-bundle variant evaluated when verdicts are supplied", () => {
    const fixtures = [
      {
        symbol: "AAPLUSDT",
        candles: [
          session(1, 100, 100),
          session(2, 102, 101),
          session(3, 99, 99.8),
          session(4, 101, 100.5),
        ],
      },
    ];
    const { holdout } = buildHoldoutCandidates({ fixtures, env: {} });
    const full = new Map(
      holdout.map(
        (candidate) =>
          [
            `${candidate.symbol}|${candidate.date}`,
            "STAND_ASIDE" as const,
          ] as const,
      ),
    );
    const report = buildGateHoldoutReport({
      manifestPath: "data/rwa-sample/manifest.json",
      gateVerdictPath: "data/aaplusdt-gate-verdicts.json",
      fixtures,
      gateCache: null,
      generatedAt: "2026-06-23T00:00:00.000Z",
      env: {},
      fullBundleVerdicts: full,
    });
    const variant = report.variants.find(
      (row) => row.name === "full_bundle_qwen_gate",
    );
    expect(variant?.status).toBe("evaluated");
    expect(variant?.evaluated).toBe(holdout.length);
  });
});
