import { readFileSync } from "node:fs";
import type { GateContext } from "./convergenceGate";

export interface GateBacktestTrade {
  ts: string;
  direction: "long" | "short";
  gapPct: number;
  returnPct: number;
}

export interface NewsContextRecord {
  date: string;
  newsSummary: string;
}

export interface GateLabelRecord {
  date: string;
  expectedFadeable: boolean;
  labelRationale: string;
}

export interface GateVerdictRecord {
  date: string;
  newsSummary?: string;
  fadeable: boolean;
  multiplier: number;
  expectedFadeable?: boolean;
  correct?: boolean;
  returnPct: number;
  rationale: string;
  labelRationale?: string;
}

export interface GateVerdictCache {
  asset: string;
  model: string;
  generatedAt?: string;
  promptSource?: string;
  contextsSource?: string;
  labelsSource?: string;
  verdicts: GateVerdictRecord[];
}

export function loadNewsContexts(path: string): Map<string, NewsContextRecord> {
  const doc = JSON.parse(readFileSync(path, "utf8")) as {
    contexts: NewsContextRecord[];
  };
  return new Map(doc.contexts.map((c) => [c.date, c]));
}

export function loadGateLabels(path: string): Map<string, GateLabelRecord> {
  const doc = JSON.parse(readFileSync(path, "utf8")) as {
    labels: GateLabelRecord[];
  };
  return new Map(doc.labels.map((l) => [l.date, l]));
}

export function loadGateVerdicts(path: string): GateVerdictCache {
  const doc = JSON.parse(readFileSync(path, "utf8")) as
    | GateVerdictCache
    | {
        asset: string;
        model: string;
        generatedAt?: string;
        promptSource?: string;
        contextsSource?: string;
        labelsSource?: string;
        results: GateVerdictRecord[];
      };
  return {
    asset: doc.asset,
    model: doc.model,
    generatedAt: doc.generatedAt,
    promptSource: doc.promptSource,
    contextsSource: doc.contextsSource,
    labelsSource: doc.labelsSource,
    verdicts: "verdicts" in doc ? doc.verdicts : doc.results,
  };
}

export function buildGateContextFromTrade(
  asset: string,
  trade: GateBacktestTrade,
  newsSummary: string,
): GateContext {
  return {
    symbol: asset,
    direction: trade.direction === "short" ? "rich" : "cheap",
    dislocationPct: trade.gapPct / 100,
    sessionLabel: "overnight (US stock off-hours)",
    newsSummary,
  };
}

export function gateStandAsideDates(
  cache: GateVerdictCache,
): Set<string> {
  return new Set(
    cache.verdicts
      .filter((v) => !v.fadeable || v.multiplier <= 0)
      .map((v) => v.date),
  );
}

export function summarizeGateAccuracy(verdicts: GateVerdictRecord[]): {
  correct: number;
  total: number;
  accuracyPct: number;
} {
  const scored = verdicts.filter(
    (v) =>
      typeof v.expectedFadeable === "boolean" && typeof v.correct === "boolean",
  );
  const correct = scored.filter((v) => v.correct).length;
  return {
    correct,
    total: scored.length,
    accuracyPct: scored.length ? (correct / scored.length) * 100 : 0,
  };
}
