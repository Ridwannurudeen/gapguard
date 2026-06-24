import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  loadGateLabels,
  loadGateVerdicts,
  loadNewsContexts,
} from "../src/gateVerdicts";

function tempJson(name: string, value: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), "gapguard-gate-"));
  const path = join(dir, name);
  writeFileSync(path, `${JSON.stringify(value)}\n`);
  return path;
}

describe("gate verdict loaders", () => {
  it("loads valid news contexts, labels, and verdicts", () => {
    const contexts = loadNewsContexts(
      tempJson("contexts.json", {
        contexts: [{ date: "2026-06-09", newsSummary: "WWDC before open" }],
      }),
    );
    const labels = loadGateLabels(
      tempJson("labels.json", {
        labels: [
          {
            date: "2026-06-09",
            expectedFadeable: false,
            labelRationale: "real catalyst",
          },
        ],
      }),
    );
    const cache = loadGateVerdicts(
      tempJson("verdicts.json", {
        asset: "AAPLUSDT",
        model: "qwen3.6-plus",
        verdicts: [
          {
            date: "2026-06-09",
            fadeable: false,
            multiplier: 0,
            expectedFadeable: false,
            correct: true,
            returnPct: -0.4,
            rationale: "stand aside",
          },
        ],
      }),
    );

    expect(contexts.get("2026-06-09")?.newsSummary).toBe(
      "WWDC before open",
    );
    expect(labels.get("2026-06-09")?.expectedFadeable).toBe(false);
    expect(cache.verdicts[0]).toMatchObject({
      date: "2026-06-09",
      fadeable: false,
      multiplier: 0,
    });
  });

  it("rejects malformed news context artifacts with a field path", () => {
    const path = tempJson("contexts.json", {
      contexts: [{ date: "2026-06-09" }],
    });

    expect(() => loadNewsContexts(path)).toThrow(
      `${path}: contexts[0].newsSummary must be a non-empty string`,
    );
  });

  it("rejects string fadeable verdicts", () => {
    const path = tempJson("verdicts.json", {
      asset: "AAPLUSDT",
      model: "qwen3.6-plus",
      verdicts: [
        {
          date: "2026-06-09",
          fadeable: "false",
          multiplier: 0,
          returnPct: -0.4,
          rationale: "stand aside",
        },
      ],
    });

    expect(() => loadGateVerdicts(path)).toThrow(
      `${path}: verdicts[0].fadeable must be a boolean`,
    );
  });

  it("rejects out-of-range multipliers", () => {
    const path = tempJson("verdicts.json", {
      asset: "AAPLUSDT",
      model: "qwen3.6-plus",
      verdicts: [
        {
          date: "2026-06-09",
          fadeable: true,
          multiplier: 1.5,
          returnPct: -0.4,
          rationale: "fade",
        },
      ],
    });

    expect(() => loadGateVerdicts(path)).toThrow(
      `${path}: verdicts[0].multiplier must be between 0 and 1`,
    );
  });
});
