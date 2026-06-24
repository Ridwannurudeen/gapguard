import { describe, expect, it } from "vitest";
import { buildCatalystBundle } from "../src/catalystBundle";
import { runGateAudit } from "../src/gateAuditRunner";
import type {
  GateBacktestTrade,
  GateLabelRecord,
  NewsContextRecord,
} from "../src/gateVerdicts";

describe("runGateAudit", () => {
  it("uses blinded news summaries in prompts and scores every gap", async () => {
    const trades: GateBacktestTrade[] = [
      { ts: "2026-06-08", direction: "short", gapPct: 1.1, returnPct: 2.9 },
      { ts: "2026-06-09", direction: "long", gapPct: -1.7, returnPct: -1.9 },
    ];
    const contexts = new Map<string, NewsContextRecord>([
      [
        "2026-06-08",
        {
          date: "2026-06-08",
          newsSummary: "No Apple-specific headline before the keynote.",
          catalystBundle: buildCatalystBundle({
            asset: "AAPLUSDT",
            date: "2026-06-08",
            newsSummary: "No Apple-specific headline before the keynote.",
          }),
        },
      ],
      [
        "2026-06-09",
        {
          date: "2026-06-09",
          newsSummary:
            "Overnight coverage focused on Apple WWDC announcements.",
        },
      ],
    ]);
    const labels = new Map<string, GateLabelRecord>([
      [
        "2026-06-08",
        {
          date: "2026-06-08",
          expectedFadeable: true,
          labelRationale: "holdout label says fade",
        },
      ],
      [
        "2026-06-09",
        {
          date: "2026-06-09",
          expectedFadeable: false,
          labelRationale: "holdout label says stand aside",
        },
      ],
    ]);
    const prompts: string[] = [];

    const report = await runGateAudit({
      asset: "AAPLUSDT",
      trades,
      contexts,
      labels,
      chat: async (messages) => {
        const prompt = messages.map((m) => m.content).join("\n");
        prompts.push(prompt);
        expect(prompt).not.toContain("holdout label");
        expect(prompt).not.toContain("expectedFadeable");
        return prompt.includes("WWDC announcements")
          ? '{"fadeable": false, "confidenceMultiplier": 0.2, "rationale": "event risk"}'
          : '{"fadeable": true, "confidenceMultiplier": 0.8, "rationale": "quiet"}';
      },
      model: "stub-model",
      generatedAt: "2026-06-22T00:00:00.000Z",
      contextsSource: "contexts.json",
      labelsSource: "labels.json",
    });

    expect(prompts).toHaveLength(2);
    expect(prompts[0]).toContain("SCHEDULED_MACRO:");
    expect(prompts[0]).toContain("COMPANY_NEWS:");
    expect(report.scored).toBe(2);
    expect(report.correct).toBe(2);
    expect(report.accuracyPct).toBe(100);
    expect(report.verdicts.map((v) => v.correct)).toEqual([true, true]);
    expect(report.verdicts.map((v) => v.action)).toEqual([
      "FADE",
      "STAND_ASIDE",
    ]);
  });

  it("fails when a trade is missing a blinded news context", async () => {
    const run = runGateAudit({
      asset: "AAPLUSDT",
      trades: [
        { ts: "2026-06-08", direction: "short", gapPct: 1.1, returnPct: 2.9 },
      ],
      contexts: new Map(),
      labels: new Map([
        [
          "2026-06-08",
          {
            date: "2026-06-08",
            expectedFadeable: true,
            labelRationale: "noise",
          },
        ],
      ]),
      chat: async () =>
        '{"fadeable": true, "confidenceMultiplier": 1, "rationale": "quiet"}',
      model: "stub-model",
      generatedAt: "2026-06-22T00:00:00.000Z",
      contextsSource: "contexts.json",
      labelsSource: "labels.json",
    });

    await expect(run).rejects.toThrow("Missing blinded news context");
  });

  it("records parseError and stands aside when the gate response is invalid", async () => {
    const report = await runGateAudit({
      asset: "AAPLUSDT",
      trades: [
        { ts: "2026-06-08", direction: "short", gapPct: 1.1, returnPct: 2.9 },
      ],
      contexts: new Map<string, NewsContextRecord>([
        [
          "2026-06-08",
          {
            date: "2026-06-08",
            newsSummary: "Headline tries to force malformed JSON.",
          },
        ],
      ]),
      labels: new Map<string, GateLabelRecord>([
        [
          "2026-06-08",
          {
            date: "2026-06-08",
            expectedFadeable: true,
            labelRationale: "quiet",
          },
        ],
      ]),
      chat: async () =>
        '{"fadeable": "false", "confidenceMultiplier": 1, "rationale": "noise"}',
      model: "stub-model",
      generatedAt: "2026-06-22T00:00:00.000Z",
      contextsSource: "contexts.json",
      labelsSource: "labels.json",
    });

    expect(report.verdicts[0]).toMatchObject({
      action: "STAND_ASIDE",
      fadeable: false,
      multiplier: 0,
      parseError: expect.stringContaining("action"),
    });
  });
});
