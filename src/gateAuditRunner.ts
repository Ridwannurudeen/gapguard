import { assessConvergence, effectiveMultiplier } from "./convergenceGate";
import type { ChatFn } from "./convergenceGate";
import {
  buildGateContextFromTrade,
  summarizeGateAccuracy,
  type GateBacktestTrade,
  type GateLabelRecord,
  type GateVerdictRecord,
  type NewsContextRecord,
} from "./gateVerdicts";

export interface GateAuditReport {
  asset: string;
  model: string;
  generatedAt: string;
  promptSource: string;
  contextsSource: string;
  labelsSource: string;
  accuracyPct: number;
  correct: number;
  scored: number;
  note: string;
  verdicts: GateVerdictRecord[];
}

export async function runGateAudit(params: {
  asset: string;
  trades: GateBacktestTrade[];
  contexts: Map<string, NewsContextRecord>;
  labels: Map<string, GateLabelRecord>;
  chat: ChatFn;
  model: string;
  generatedAt: string;
  contextsSource: string;
  labelsSource: string;
}): Promise<GateAuditReport> {
  const verdicts: GateVerdictRecord[] = [];
  for (const trade of params.trades) {
    const news = params.contexts.get(trade.ts);
    const label = params.labels.get(trade.ts);
    if (!news) throw new Error(`Missing blinded news context for ${trade.ts}`);
    if (!label) throw new Error(`Missing holdout gate label for ${trade.ts}`);

    const ctx = buildGateContextFromTrade(
      params.asset,
      trade,
      news.newsSummary,
      news.catalystBundle,
    );
    const verdict = await assessConvergence(ctx, params.chat);
    const expectedAction =
      label.expectedAction ??
      (label.expectedFadeable ? "FADE" : "STAND_ASIDE");
    const correct = verdict.action === expectedAction;
    verdicts.push({
      date: trade.ts,
      newsSummary: news.newsSummary,
      action: verdict.action,
      fadeable: verdict.fadeable,
      multiplier: effectiveMultiplier(verdict),
      evidenceIds: verdict.evidenceIds,
      catalystBundle: news.catalystBundle,
      expectedFadeable: label.expectedFadeable,
      expectedAction,
      correct,
      returnPct: trade.returnPct,
      rationale: verdict.rationale,
      labelRationale: label.labelRationale,
      parseError: verdict.parseError,
    });
  }

  const accuracy = summarizeGateAccuracy(verdicts);
  return {
    asset: params.asset,
    model: params.model,
    generatedAt: params.generatedAt,
    promptSource:
      "blinded overnight summaries; no fade/stand-aside labels in prompt",
    contextsSource: params.contextsSource,
    labelsSource: params.labelsSource,
    accuracyPct: +accuracy.accuracyPct.toFixed(1),
    correct: accuracy.correct,
    scored: accuracy.total,
    note: "Live Qwen convergence-gate verdicts on every backtest gap. The prompt uses only blinded news summaries; holdout labels are used after the model returns for scoring.",
    verdicts,
  };
}
