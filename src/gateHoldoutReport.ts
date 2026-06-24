import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { collapseSessions, type Candle, type DaySession } from "./gapEngine";
import { loadGateVerdicts, type GateVerdictCache } from "./gateVerdicts";
import type { GateAction } from "./convergenceGate";
import { loadCandleFixture, loadRwaSampleManifest } from "./multiBacktest";
import {
  resolveExecutionAssumptions,
  type ExecutionAssumption,
} from "./slippage";
import { holdoutVerdictMap, loadHoldoutGateCache } from "./holdoutGateCache";

const GAP_THRESHOLD = Number(process.env.BT_GAP_THRESHOLD ?? "0.004");
const COST_PER_SIDE = Number(process.env.BT_COST ?? "0.0005");
const ACTIONS: GateAction[] = ["FADE", "FOLLOW", "STAND_ASIDE"];

export interface HoldoutCandidate {
  symbol: string;
  date: string;
  gapPct: number;
  fadeReturnPct: number;
  followReturnPct: number;
  oracleAction: GateAction;
}

export interface CostWeightedConfusionCell {
  count: number;
  costPct: number;
}

export type CostWeightedConfusionMatrix = Record<
  GateAction,
  Record<GateAction, CostWeightedConfusionCell>
>;

export interface GateHoldoutVariant {
  name: string;
  scope: string;
  status: "evaluated" | "not_run_missing_key" | "not_applicable";
  evaluated: number;
  accuracyPct: number | null;
  meanRegretPct: number | null;
  confusion: CostWeightedConfusionMatrix;
}

export interface GateHoldoutReport {
  generatedAt: string;
  strategy: string;
  data: {
    manifestPath: string;
    symbols: string[];
    candidates: number;
    formationCandidates: number;
    holdoutCandidates: number;
    holdoutStart: string | null;
  };
  protocol: {
    split: string;
    gapThresholdPct: number;
    costPerSidePct: number;
    executionAssumptionSource: string;
    oracle: string;
    noTuning: string;
  };
  variants: GateHoldoutVariant[];
  limitations: string[];
}

function round(value: number, digits = 3): number {
  return +value.toFixed(digits);
}

function candidateReturns(
  sessions: DaySession[],
  symbol: string,
  execution: ExecutionAssumption,
): HoldoutCandidate[] {
  const out: HoldoutCandidate[] = [];
  const totalCostPct =
    (2 * (COST_PER_SIDE + execution.slippageBps / 10_000) +
      Math.abs(execution.fundingRate)) *
    100;
  for (let i = 1; i < sessions.length; i += 1) {
    const prior = sessions[i - 1];
    const today = sessions[i];
    const gap = today.openPrice / prior.closePrice - 1;
    if (Math.abs(gap) < GAP_THRESHOLD) continue;
    const fadeGross =
      gap > 0
        ? (today.openPrice - today.closePrice) / today.openPrice
        : (today.closePrice - today.openPrice) / today.openPrice;
    const fadeReturnPct = round(fadeGross * 100 - totalCostPct);
    const followReturnPct = round(-fadeGross * 100 - totalCostPct);
    const bestReturn = Math.max(0, fadeReturnPct, followReturnPct);
    out.push({
      symbol,
      date: today.date,
      gapPct: round(gap * 100),
      fadeReturnPct,
      followReturnPct,
      oracleAction:
        bestReturn === 0
          ? "STAND_ASIDE"
          : fadeReturnPct >= followReturnPct
            ? "FADE"
            : "FOLLOW",
    });
  }
  return out;
}

function returnFor(candidate: HoldoutCandidate, action: GateAction): number {
  if (action === "FADE") return candidate.fadeReturnPct;
  if (action === "FOLLOW") return candidate.followReturnPct;
  return 0;
}

function blankConfusion(): CostWeightedConfusionMatrix {
  return Object.fromEntries(
    ACTIONS.map((expected) => [
      expected,
      Object.fromEntries(
        ACTIONS.map((predicted) => [predicted, { count: 0, costPct: 0 }]),
      ),
    ]),
  ) as CostWeightedConfusionMatrix;
}

function evaluateVariant(
  name: string,
  scope: string,
  candidates: HoldoutCandidate[],
  predict: (candidate: HoldoutCandidate) => GateAction | null,
  status: GateHoldoutVariant["status"] = "evaluated",
): GateHoldoutVariant {
  const confusion = blankConfusion();
  let evaluated = 0;
  let correct = 0;
  let regret = 0;
  for (const candidate of candidates) {
    const predicted = predict(candidate);
    if (!predicted) continue;
    evaluated += 1;
    if (predicted === candidate.oracleAction) correct += 1;
    const oracleReturn = returnFor(candidate, candidate.oracleAction);
    const predictedReturn = returnFor(candidate, predicted);
    const cost = Math.max(0, oracleReturn - predictedReturn);
    regret += cost;
    const cell = confusion[candidate.oracleAction][predicted];
    cell.count += 1;
    cell.costPct = round(cell.costPct + cost);
  }

  return {
    name,
    scope,
    status,
    evaluated,
    accuracyPct: evaluated ? round((correct / evaluated) * 100, 1) : null,
    meanRegretPct: evaluated ? round(regret / evaluated) : null,
    confusion,
  };
}

function holdoutStart(candidates: HoldoutCandidate[]): string | null {
  const dates = [
    ...new Set(candidates.map((candidate) => candidate.date)),
  ].sort();
  if (dates.length === 0) return null;
  return dates[Math.floor(dates.length * 0.6)] ?? dates.at(-1) ?? null;
}

function cachedGatePredictor(
  cache: GateVerdictCache | null,
): (candidate: HoldoutCandidate) => GateAction | null {
  const byDate = new Map(
    cache?.verdicts.map((row) => [row.date, row.action]) ?? [],
  );
  return (candidate) =>
    cache && candidate.symbol === cache.asset
      ? (byDate.get(candidate.date) ?? null)
      : null;
}

export interface HoldoutCandidateSet {
  candidates: HoldoutCandidate[];
  formation: HoldoutCandidate[];
  holdout: HoldoutCandidate[];
  splitDate: string | null;
  executionSource: string;
}

export function buildHoldoutCandidates(params: {
  fixtures: { symbol: string; candles: Candle[] }[];
  env?: NodeJS.ProcessEnv;
}): HoldoutCandidateSet {
  const executionAssumptions = resolveExecutionAssumptions(
    params.fixtures.map((fixture) => fixture.symbol),
    params.env ?? process.env,
  );
  const candidates = params.fixtures
    .flatMap((fixture) =>
      candidateReturns(
        collapseSessions(fixture.candles),
        fixture.symbol,
        executionAssumptions.bySymbol[fixture.symbol] ??
          executionAssumptions.fallback,
      ),
    )
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) || a.symbol.localeCompare(b.symbol),
    );
  const splitDate = holdoutStart(candidates);
  const holdout = splitDate
    ? candidates.filter((candidate) => candidate.date >= splitDate)
    : [];
  const formation = splitDate
    ? candidates.filter((candidate) => candidate.date < splitDate)
    : candidates;
  return {
    candidates,
    formation,
    holdout,
    splitDate,
    executionSource: executionAssumptions.source,
  };
}

export function buildGateHoldoutReport(params: {
  manifestPath: string;
  gateVerdictPath: string;
  fixtures: { symbol: string; candles: Candle[] }[];
  gateCache: GateVerdictCache | null;
  generatedAt: string;
  env?: NodeJS.ProcessEnv;
  fullBundleVerdicts?: Map<string, GateAction> | null;
}): GateHoldoutReport {
  const { candidates, formation, holdout, splitDate, executionSource } =
    buildHoldoutCandidates({ fixtures: params.fixtures, env: params.env });
  const cachedPredictor = cachedGatePredictor(params.gateCache);
  const fullBundle = params.fullBundleVerdicts ?? null;

  return {
    generatedAt: params.generatedAt,
    strategy: "GapGuard gate holdout evaluation",
    data: {
      manifestPath: params.manifestPath.replaceAll("\\", "/"),
      symbols: params.fixtures.map((fixture) => fixture.symbol),
      candidates: candidates.length,
      formationCandidates: formation.length,
      holdoutCandidates: holdout.length,
      holdoutStart: splitDate,
    },
    protocol: {
      split:
        "First 60% of unique gap dates are formation only; metrics are reported on the later holdout dates.",
      gapThresholdPct: GAP_THRESHOLD * 100,
      costPerSidePct: COST_PER_SIDE * 100,
      executionAssumptionSource: executionSource,
      oracle:
        "Oracle label is the best post-cost action among FADE, FOLLOW, and STAND_ASIDE for evaluation only.",
      noTuning:
        "No thresholds are tuned on this holdout. Always-fade and macro-stand-aside are fixed ablations; the oracle is computed post-hoc for scoring only and never fed to the model.",
    },
    variants: [
      evaluateVariant(
        "always_fade",
        "all holdout symbols",
        holdout,
        () => "FADE",
      ),
      evaluateVariant(
        "jobs_fomc_macro_stand_aside",
        "all holdout symbols; fixed calendar dates only",
        holdout,
        (candidate) =>
          candidate.date === "2026-06-05" || candidate.date === "2026-06-18"
            ? "STAND_ASIDE"
            : "FADE",
      ),
      evaluateVariant(
        "cached_aapl_qwen_gate",
        `${params.gateVerdictPath.replaceAll("\\", "/")} only`,
        holdout,
        cachedPredictor,
        params.gateCache ? "evaluated" : "not_applicable",
      ),
      evaluateVariant(
        "full_bundle_qwen_gate",
        fullBundle
          ? "live Qwen catalyst-gate scoring across all holdout symbols with the macro catalyst bundle (cached to data/holdout-gate-verdicts.json)"
          : "requires a cached live Qwen run: npm run holdout:score with BITGET_QWEN_API_KEY",
        fullBundle ? holdout : [],
        (candidate) =>
          fullBundle?.get(`${candidate.symbol}|${candidate.date}`) ?? null,
        fullBundle ? "evaluated" : "not_run_missing_key",
      ),
    ],
    limitations: [
      "This artifact is an evaluation report, not a trained model.",
      "The oracle uses realized returns after the open, so it is never fed back into prompts or trading decisions.",
      fullBundle
        ? "Full-bundle Qwen verdicts cover all holdout symbols (live keyed run, cached); cached_aapl_qwen_gate remains AAPL-only by design. Company-news coverage varies by symbol; index proxies (QQQ/SPY/NDX100/SP500) carry macro/index/cross-asset context only."
        : "Cached Qwen verdicts cover AAPLUSDT only; multi-symbol Qwen scoring requires a fresh keyed run (npm run holdout:score).",
      "RWA candles are Bitget tokenized-stock futures candles, not primary exchange equity prints.",
    ],
  };
}

export function runGateHoldoutCli(): void {
  const manifestPath = resolve(
    process.argv[2] ?? "data/rwa-sample/manifest.json",
  );
  const gateVerdictPath = resolve(
    process.argv[3] ?? "data/aaplusdt-gate-verdicts.json",
  );
  const out = resolve(process.argv[4] ?? "artifacts/gate-holdout-report.json");
  const manifest = loadRwaSampleManifest(manifestPath);
  const fixtures = manifest.symbols.map((row) =>
    loadCandleFixture(resolve(row.file)),
  );
  const gateCache = existsSync(gateVerdictPath)
    ? loadGateVerdicts(gateVerdictPath)
    : null;
  const holdoutVerdictPath = resolve(
    process.argv[5] ?? "data/holdout-gate-verdicts.json",
  );
  const fullBundleVerdicts = existsSync(holdoutVerdictPath)
    ? holdoutVerdictMap(loadHoldoutGateCache(holdoutVerdictPath))
    : null;
  const report = buildGateHoldoutReport({
    manifestPath,
    gateVerdictPath,
    fixtures,
    gateCache,
    generatedAt: new Date().toISOString(),
    fullBundleVerdicts,
  });
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
  console.log(
    `gate holdout: ${report.data.holdoutCandidates}/${report.data.candidates} candidates, ${report.data.symbols.length} symbols -> ${out}`,
  );
}

if (process.argv[1]?.endsWith("gateHoldoutReport.ts")) {
  runGateHoldoutCli();
}
