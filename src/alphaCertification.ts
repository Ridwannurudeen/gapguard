import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  collapseSessions,
  summarize,
  type BacktestMetrics,
  type Candle,
  type DaySession,
  type Trade,
} from "./gapEngine";
import {
  buildMultiBacktestReport,
  loadCandleFixture,
  loadRwaSampleManifest,
  type RwaSampleManifest,
} from "./multiBacktest";
import {
  resolveExecutionAssumptions,
  type ExecutionAssumption,
} from "./slippage";

const GAP_THRESHOLD = Number(process.env.ALPHA_GAP_THRESHOLD ?? "0.004");
const COST_PER_SIDE = Number(process.env.BT_COST ?? "0.0005");
const START_EQUITY = 1000;
const FORMATION_FRACTION = 0.6;
const LOOKBACK_TRADES = 80;
const MIN_PRIOR_TRADES = 40;
const MIN_PRIOR_WIN_RATE = 0.55;
const MIN_PRIOR_MEAN = 0;
const MIN_OOS_TRADES = 30;

type Direction = "long" | "short";

interface GapCandidate {
  symbol: string;
  date: string;
  priorClose: number;
  openPrice: number;
  closePrice: number;
  gapPct: number;
  fadeDirection: Direction;
  followDirection: Direction;
  fadeReturnPct: number;
  followReturnPct: number;
}

export interface AlphaCertificationReport {
  schemaVersion: 1;
  generatedAt: string;
  strategy: string;
  claim: string;
  data: {
    manifestPath: string;
    source: string;
    granularity: string;
    symbols: string[];
    window: { from: string | undefined; to: string | undefined };
    inputHash: string;
  };
  protocol: {
    selectionRule: string;
    splitMethod: string;
    outOfSampleStart: string;
    gapThresholdPct: number;
    lookbackTrades: number;
    bucket: "same_direction";
    minPriorTrades: number;
    minPriorMeanPct: number;
    minPriorWinRatePct: number;
    minOosTrades: number;
    costPerSidePct: number;
    slippagePerSideBps: number;
    slippageSource: string;
  };
  baselines: {
    fullSampleAlwaysFade: BacktestMetrics & {
      symbols: number;
      maxDrawdownMethod: string;
    };
    outOfSampleAlwaysFade: BacktestMetrics;
    outOfSampleAlwaysFollow: BacktestMetrics;
  };
  outOfSample: {
    alphaStatus: "positive" | "negative" | "unproven";
    metrics: BacktestMetrics;
    riskAdjusted: {
      sharpePerTrade: number;
      portfolioDailySharpeAnnualized: number;
      oosTradingDays: number;
      note: string;
    };
    vsAlwaysFadeReturnPct: number;
    selectedTrades: Trade[];
    rejectedCandidates: number;
  };
  passportEvidence: {
    source: string;
    variant: "walkForwardRwaFollow";
    returnPct: number;
    sharpeAnnualized: number;
    totalTrades: number;
    alphaStatus: "positive" | "negative" | "unproven";
    note: string;
  };
  limitations: string[];
}

function inputHash(manifest: RwaSampleManifest): string {
  const hash = createHash("sha256");
  hash.update(JSON.stringify(manifest));
  for (const row of manifest.symbols) {
    hash.update(readFileSync(resolve(row.file)));
  }
  return hash.digest("hex");
}

function gapCandidates(
  symbol: string,
  sessions: DaySession[],
  costPerSide: number,
  execution: ExecutionAssumption,
): GapCandidate[] {
  const out: GapCandidate[] = [];
  const totalCost =
    2 * (costPerSide + execution.slippageBps / 10_000) +
    Math.abs(execution.fundingRate);
  for (let i = 1; i < sessions.length; i += 1) {
    const prior = sessions[i - 1];
    const today = sessions[i];
    const gap = today.openPrice / prior.closePrice - 1;
    if (Math.abs(gap) < GAP_THRESHOLD) continue;

    const fadeDirection: Direction = gap > 0 ? "short" : "long";
    const followDirection: Direction =
      fadeDirection === "short" ? "long" : "short";
    const grossFade =
      fadeDirection === "short"
        ? (today.openPrice - today.closePrice) / today.openPrice
        : (today.closePrice - today.openPrice) / today.openPrice;
    out.push({
      symbol,
      date: today.date,
      priorClose: prior.closePrice,
      openPrice: today.openPrice,
      closePrice: today.closePrice,
      gapPct: +(gap * 100).toFixed(3),
      fadeDirection,
      followDirection,
      fadeReturnPct: +((grossFade - totalCost) * 100).toFixed(3),
      followReturnPct: +((-grossFade - totalCost) * 100).toFixed(3),
    });
  }
  return out;
}

function outOfSampleStart(candidates: GapCandidate[]): string {
  const dates = [
    ...new Set(candidates.map((candidate) => candidate.date)),
  ].sort();
  const index = Math.floor(dates.length * FORMATION_FRACTION);
  return dates[index] ?? dates[dates.length - 1] ?? "1970-01-01";
}

function toTrade(
  candidate: GapCandidate,
  direction: Direction,
  returnPct: number,
  balanceBefore: number,
): Trade {
  const balanceAfter = balanceBefore * (1 + returnPct / 100);
  return {
    ts: candidate.date,
    asset: candidate.symbol,
    direction,
    gapPct: candidate.gapPct,
    entryPrice: +candidate.openPrice.toFixed(2),
    exitPrice: +candidate.closePrice.toFixed(2),
    qty: +(balanceBefore / candidate.openPrice).toFixed(4),
    returnPct,
    balanceBefore: +balanceBefore.toFixed(2),
    balanceAfter: +balanceAfter.toFixed(2),
  };
}

function compoundBySymbol(
  candidates: GapCandidate[],
  selector: (
    candidate: GapCandidate,
  ) => { direction: Direction; returnPct: number } | null,
): Trade[] {
  const balances = new Map<string, number>();
  const trades: Trade[] = [];
  for (const candidate of candidates) {
    const selected = selector(candidate);
    if (!selected) continue;
    const balanceBefore = balances.get(candidate.symbol) ?? START_EQUITY;
    const trade = toTrade(
      candidate,
      selected.direction,
      selected.returnPct,
      balanceBefore,
    );
    balances.set(candidate.symbol, trade.balanceAfter);
    trades.push(trade);
  }
  return trades;
}

function summarizeOos(
  trades: Trade[],
  sessions: DaySession[],
): BacktestMetrics {
  return summarize(trades, sessions, START_EQUITY);
}

function portfolioMetrics(
  trades: Trade[],
  sessions: DaySession[],
  symbolCount: number,
): BacktestMetrics {
  const base = summarizeOos(trades, sessions);
  const endingBySymbol = new Map<string, number>();
  for (const trade of trades) {
    endingBySymbol.set(trade.asset, trade.balanceAfter);
  }
  const endingEquity =
    [...endingBySymbol.values()].reduce((sum, value) => sum + value, 0) +
    (symbolCount - endingBySymbol.size) * START_EQUITY;
  return {
    ...base,
    totalReturnPct: +(
      (endingEquity / (symbolCount * START_EQUITY) - 1) *
      100
    ).toFixed(3),
    endingEquity: +endingEquity.toFixed(2),
  };
}

/**
 * Honest portfolio risk-adjusted stats. Same-day trades across symbols are correlated,
 * parallel positions — not independent sequential bets — so we aggregate each day's
 * trades into ONE equal-weight daily portfolio return and Sharpe-annualize by sqrt(252).
 * This avoids the inflation of per-trade Sharpe x sqrt(trades-per-year), which treats
 * ~6 parallel daily positions as 6 independent annual bets.
 */
function portfolioDailyStats(
  trades: Trade[],
  symbolCount: number,
): { dailySharpeAnnualized: number; oosTradingDays: number } {
  const byDate = new Map<string, number>();
  for (const trade of trades) {
    byDate.set(trade.ts, (byDate.get(trade.ts) ?? 0) + trade.returnPct / 100);
  }
  const daily = [...byDate.values()].map((sum) => sum / symbolCount);
  const n = daily.length;
  if (n < 2) return { dailySharpeAnnualized: 0, oosTradingDays: n };
  const mean = daily.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(
    daily.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1),
  );
  const dailySharpe = sd ? mean / sd : 0;
  return {
    dailySharpeAnnualized: +(dailySharpe * Math.sqrt(252)).toFixed(3),
    oosTradingDays: n,
  };
}

function certifyAlpha(
  selected: BacktestMetrics,
  alwaysFade: BacktestMetrics,
): "positive" | "negative" | "unproven" {
  if (selected.totalTrades < MIN_OOS_TRADES) return "unproven";
  if (
    selected.totalReturnPct > 0 &&
    selected.sharpeAnnualized > 0 &&
    selected.profitFactor !== null &&
    selected.profitFactor > 1 &&
    selected.totalReturnPct > alwaysFade.totalReturnPct
  ) {
    return "positive";
  }
  return "negative";
}

export function buildAlphaCertificationReport(
  manifestPath: string,
  outPath = "artifacts/rwa-alpha-certification.json",
  generatedAt = new Date().toISOString(),
): AlphaCertificationReport {
  const manifest = loadRwaSampleManifest(manifestPath);
  const fixtures = manifest.symbols.map((row) =>
    loadCandleFixture(resolve(row.file)),
  );
  const executionAssumptions = resolveExecutionAssumptions(
    fixtures.map((fixture) => fixture.symbol),
  );
  const averageSlippage = fixtures.length
    ? fixtures.reduce(
        (sum, fixture) =>
          sum +
          (executionAssumptions.bySymbol[fixture.symbol] ??
            executionAssumptions.fallback).slippageBps,
        0,
      ) / fixtures.length
    : 0;
  const bySymbol = fixtures.map((fixture) => ({
    fixture,
    sessions: collapseSessions(fixture.candles as Candle[]),
  }));
  const candidates = bySymbol
    .flatMap(({ fixture, sessions }) =>
      gapCandidates(
        fixture.symbol,
        sessions,
        COST_PER_SIDE,
        executionAssumptions.bySymbol[fixture.symbol] ??
          executionAssumptions.fallback,
      ),
    )
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) || a.symbol.localeCompare(b.symbol),
    );
  const oosStart = outOfSampleStart(candidates);
  const oosCandidates = candidates.filter(
    (candidate) => candidate.date >= oosStart,
  );
  const allSessions = bySymbol.flatMap((row) => row.sessions);

  const fullSampleAlwaysFade = buildMultiBacktestReport(fixtures, {
    gapThreshold: GAP_THRESHOLD,
    costPerSide: COST_PER_SIDE,
    executionAssumptions,
    startEquity: START_EQUITY,
  }).aggregate;
  const oosAlwaysFadeTrades = compoundBySymbol(oosCandidates, (candidate) => ({
    direction: candidate.fadeDirection,
    returnPct: candidate.fadeReturnPct,
  }));
  const oosAlwaysFollowTrades = compoundBySymbol(
    oosCandidates,
    (candidate) => ({
      direction: candidate.followDirection,
      returnPct: candidate.followReturnPct,
    }),
  );

  let rejectedCandidates = 0;
  const selectedTrades = compoundBySymbol(oosCandidates, (candidate) => {
    // Strictly-earlier dates only: same-date trades (other symbols) resolve at the same
    // session close, so their outcomes are unknown at this entry — including them in the
    // trailing signal would leak look-ahead.
    const prior = candidates
      .filter(
        (row) =>
          row.date < candidate.date &&
          row.fadeDirection === candidate.fadeDirection,
      )
      .slice(-LOOKBACK_TRADES);
    if (prior.length < MIN_PRIOR_TRADES) {
      rejectedCandidates += 1;
      return null;
    }

    const priorMean =
      prior.reduce((sum, row) => sum + row.followReturnPct, 0) / prior.length;
    const priorWinRate =
      prior.filter((row) => row.followReturnPct > 0).length / prior.length;
    if (priorMean <= MIN_PRIOR_MEAN || priorWinRate < MIN_PRIOR_WIN_RATE) {
      rejectedCandidates += 1;
      return null;
    }
    return {
      direction: candidate.followDirection,
      returnPct: candidate.followReturnPct,
    };
  });

  const oosAlwaysFade = portfolioMetrics(
    oosAlwaysFadeTrades,
    allSessions,
    fixtures.length,
  );
  const oosAlwaysFollow = portfolioMetrics(
    oosAlwaysFollowTrades,
    allSessions,
    fixtures.length,
  );
  const selectedMetrics = portfolioMetrics(
    selectedTrades,
    allSessions,
    fixtures.length,
  );
  const selectedDaily = portfolioDailyStats(selectedTrades, fixtures.length);
  const alphaStatus = certifyAlpha(selectedMetrics, oosAlwaysFade);
  const source = outPath.replaceAll("\\", "/");

  return {
    schemaVersion: 1,
    generatedAt,
    strategy: "GapGuard walk-forward RWA gap-follow pilot",
    claim:
      "Walk-forward out-of-sample evidence for selective RWA gap-following after costs; not a live-fill claim.",
    data: {
      manifestPath: manifestPath.replaceAll("\\", "/"),
      source:
        manifest.source ?? "public Bitget /api/v2/mix/market/history-candles",
      granularity:
        manifest.granularity ?? fixtures[0]?.granularity ?? "unknown",
      symbols: fixtures.map((fixture) => fixture.symbol),
      window: {
        from: manifest.symbols
          .map((row) => row.from)
          .filter(Boolean)
          .sort()[0],
        to: manifest.symbols
          .map((row) => row.to)
          .filter(Boolean)
          .sort()
          .at(-1),
      },
      inputHash: inputHash(manifest),
    },
    protocol: {
      selectionRule:
        "Out-of-sample gap-follow trade is allowed only when the last 80 same-direction RWA gap-follow outcomes have at least 40 observations, positive mean return, and at least 55% wins.",
      splitMethod:
        "First 60% of unique gap dates are formation history; later dates are the out-of-sample pilot window.",
      outOfSampleStart: oosStart,
      gapThresholdPct: GAP_THRESHOLD * 100,
      lookbackTrades: LOOKBACK_TRADES,
      bucket: "same_direction",
      minPriorTrades: MIN_PRIOR_TRADES,
      minPriorMeanPct: MIN_PRIOR_MEAN * 100,
      minPriorWinRatePct: MIN_PRIOR_WIN_RATE * 100,
      minOosTrades: MIN_OOS_TRADES,
      costPerSidePct: COST_PER_SIDE * 100,
      slippagePerSideBps: +averageSlippage.toFixed(3),
      slippageSource: executionAssumptions.source,
    },
    baselines: {
      fullSampleAlwaysFade,
      outOfSampleAlwaysFade: oosAlwaysFade,
      outOfSampleAlwaysFollow: oosAlwaysFollow,
    },
    outOfSample: {
      alphaStatus,
      metrics: selectedMetrics,
      riskAdjusted: {
        sharpePerTrade: selectedMetrics.sharpePerTrade,
        portfolioDailySharpeAnnualized: selectedDaily.dailySharpeAnnualized,
        oosTradingDays: selectedDaily.oosTradingDays,
        note: "Honest risk-adjusted view. BOTH annualized Sharpes are unreliable here — only this many OOS trading days. metrics.sharpeAnnualized is the worst (it annualizes per-trade Sharpe by trade frequency, treating same-day correlated positions as independent sequential bets); portfolioDailySharpeAnnualized aggregates each day into one return but is still noisy at this sample. Lean on the raw OOS return vs always-fade, win rate, and profit factor — not a Sharpe.",
      },
      vsAlwaysFadeReturnPct: +(
        selectedMetrics.totalReturnPct - oosAlwaysFade.totalReturnPct
      ).toFixed(3),
      selectedTrades,
      rejectedCandidates,
    },
    passportEvidence: {
      source,
      variant: "walkForwardRwaFollow",
      returnPct: selectedMetrics.totalReturnPct,
      sharpeAnnualized: selectedDaily.dailySharpeAnnualized,
      totalTrades: selectedMetrics.totalTrades,
      alphaStatus,
      note:
        alphaStatus === "positive"
          ? "walk-forward RWA pilot is positive after costs on the current out-of-sample window; still not a live-fill claim"
          : "walk-forward RWA pilot did not clear positive evidence requirements; live capital remains disabled",
    },
    limitations: [
      `Tiny out-of-sample window: ${selectedDaily.oosTradingDays} OOS trading days (full data ~83 days)`,
      "metrics.sharpeAnnualized is trade-frequency-annualized and OVERSTATES risk-adjusted return; use portfolioDailySharpeAnnualized — same-day trades are parallel correlated positions, not independent sequential bets",
      "Tokenized RWA futures candles, not underlying-equity exchange candles",
      "Rule constants are hardcoded and walk-forward, but not independently proven free of researcher parameter-selection bias; treat as a hypothesis, not a live edge",
      "Live stock-perp fill remains approval-gated and separate from this backtest artifact",
    ],
  };
}

export function writeAlphaCertificationReport(
  report: AlphaCertificationReport,
  outPath: string,
): void {
  mkdirSync(dirname(resolve(outPath)), { recursive: true });
  writeFileSync(resolve(outPath), `${JSON.stringify(report, null, 2)}\n`);
}

export async function runAlphaCertificationCli(): Promise<void> {
  const manifestPath = process.argv[2] ?? "data/rwa-sample/manifest.json";
  const out = process.argv[3] ?? "artifacts/rwa-alpha-certification.json";
  const report = buildAlphaCertificationReport(manifestPath, out);
  writeAlphaCertificationReport(report, out);
  const ra = report.outOfSample.riskAdjusted;
  console.log(
    `RWA walk-forward pilot — ${report.outOfSample.alphaStatus}, ${report.outOfSample.metrics.totalTrades} OOS trades over ${ra.oosTradingDays} trading days, return ${report.outOfSample.metrics.totalReturnPct}%, portfolio-daily Sharpe ${ra.portfolioDailySharpeAnnualized} (per-trade ${ra.sharpePerTrade})`,
  );
  console.table({
    selected: {
      "return %": report.outOfSample.metrics.totalReturnPct,
      "daily sharpe": ra.portfolioDailySharpeAnnualized,
      "per-trade sharpe": ra.sharpePerTrade,
      trades: report.outOfSample.metrics.totalTrades,
      "win %": report.outOfSample.metrics.winRatePct,
      PF: report.outOfSample.metrics.profitFactor,
    },
    "OOS always-fade": {
      "return %": report.baselines.outOfSampleAlwaysFade.totalReturnPct,
      "sharpe ann.": report.baselines.outOfSampleAlwaysFade.sharpeAnnualized,
      trades: report.baselines.outOfSampleAlwaysFade.totalTrades,
      "win %": report.baselines.outOfSampleAlwaysFade.winRatePct,
      PF: report.baselines.outOfSampleAlwaysFade.profitFactor,
    },
  });
  console.log(`saved: ${resolve(out)}`);
}

if (process.argv[1]?.endsWith("alphaCertification.ts")) {
  await runAlphaCertificationCli();
}
