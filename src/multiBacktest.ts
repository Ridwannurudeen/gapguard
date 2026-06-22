import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  collapseSessions,
  computeGapTrades,
  summarize,
  type BacktestMetrics,
  type Candle,
  type Trade,
} from "./gapEngine";
import { resolveBacktestSlippage } from "./slippage";

const GAP_THRESHOLD = Number(process.env.BT_GAP_THRESHOLD ?? "0.004");
const COST_PER_SIDE = Number(process.env.BT_COST ?? "0.0005");
const START_EQUITY = 1000;

export interface CandleFixture {
  symbol: string;
  granularity: string;
  candles: Candle[];
}

export interface SymbolBacktest {
  symbol: string;
  interval: string;
  window: {
    from: string | undefined;
    to: string | undefined;
    sessions: number;
  };
  metrics: BacktestMetrics;
  trades: Trade[];
}

export interface MultiBacktestReport {
  strategy: string;
  dataSource: string;
  params: {
    gapThresholdPct: number;
    costPerSidePct: number;
    slippagePerSideBps: number;
    slippageSource: string;
    startEquityPerSymbol: number;
  };
  aggregate: BacktestMetrics & {
    symbols: number;
    maxDrawdownMethod: string;
  };
  symbols: SymbolBacktest[];
}

function aggregateMetrics(
  symbols: SymbolBacktest[],
  startEquityPerSymbol: number,
): BacktestMetrics & { symbols: number; maxDrawdownMethod: string } {
  const trades = symbols.flatMap((symbol) => symbol.trades);
  const returns = trades.map((trade) => trade.returnPct / 100);
  const wins = returns.filter((r) => r > 0);
  const losses = returns.filter((r) => r <= 0);
  const mean = returns.length
    ? returns.reduce((a, b) => a + b, 0) / returns.length
    : 0;
  const sd =
    returns.length > 1
      ? Math.sqrt(
          returns.reduce((a, b) => a + (b - mean) ** 2, 0) /
            (returns.length - 1),
        )
      : 0;
  const allDates = symbols.flatMap((symbol) =>
    [symbol.window.from, symbol.window.to].filter(
      (date): date is string => typeof date === "string",
    ),
  );
  const first = allDates.length
    ? Math.min(...allDates.map((date) => new Date(`${date}T00:00:00Z`).getTime()))
    : 0;
  const last = allDates.length
    ? Math.max(...allDates.map((date) => new Date(`${date}T00:00:00Z`).getTime()))
    : 0;
  const spanDays = last > first ? (last - first) / 86_400_000 : 0;
  const tradesPerYear = spanDays > 0 ? returns.length / (spanDays / 365) : 0;
  const sharpePerTrade = sd ? mean / sd : 0;
  const grossWin = wins.reduce((a, b) => a + b, 0);
  const grossLoss = Math.abs(losses.reduce((a, b) => a + b, 0));
  const endingEquity = symbols.reduce(
    (sum, symbol) => sum + symbol.metrics.endingEquity,
    0,
  );
  const startEquity = symbols.length * startEquityPerSymbol;
  const profitFactor = grossLoss
    ? grossWin / grossLoss
    : grossWin > 0
      ? Infinity
      : 0;

  return {
    symbols: symbols.length,
    totalReturnPct: startEquity ? +((endingEquity / startEquity - 1) * 100).toFixed(3) : 0,
    sharpePerTrade: +sharpePerTrade.toFixed(3),
    sharpeAnnualized: +(sharpePerTrade * Math.sqrt(tradesPerYear)).toFixed(3),
    maxDrawdownPct: +Math.max(
      0,
      ...symbols.map((symbol) => symbol.metrics.maxDrawdownPct),
    ).toFixed(3),
    maxDrawdownMethod: "worst per-symbol drawdown, not portfolio-synchronized",
    winRatePct: returns.length ? +((wins.length / returns.length) * 100).toFixed(1) : 0,
    totalTrades: trades.length,
    profitFactor: Number.isFinite(profitFactor)
      ? +profitFactor.toFixed(2)
      : null,
    endingEquity: +endingEquity.toFixed(2),
  };
}

export function buildMultiBacktestReport(
  fixtures: CandleFixture[],
  opts: {
    gapThreshold: number;
    costPerSide: number;
    slippageBps: number;
    slippageSource: string;
    startEquity: number;
  },
): MultiBacktestReport {
  const symbolReports = fixtures.map((fixture) => {
    const sessions = collapseSessions(fixture.candles);
    const trades = computeGapTrades(fixture.symbol, sessions, {
      gapThreshold: opts.gapThreshold,
      costPerSide: opts.costPerSide,
      slippageBps: opts.slippageBps,
      startEquity: opts.startEquity,
    });
    return {
      symbol: fixture.symbol,
      interval: fixture.granularity,
      window: {
        from: sessions[0]?.date,
        to: sessions[sessions.length - 1]?.date,
        sessions: sessions.length,
      },
      metrics: summarize(trades, sessions, opts.startEquity),
      trades,
    };
  });

  return {
    strategy: "GapGuard multi-symbol off-hours gap reversion",
    dataSource: "public Bitget /api/v2/mix/market/history-candles (no key)",
    params: {
      gapThresholdPct: opts.gapThreshold * 100,
      costPerSidePct: opts.costPerSide * 100,
      slippagePerSideBps: opts.slippageBps,
      slippageSource: opts.slippageSource,
      startEquityPerSymbol: opts.startEquity,
    },
    aggregate: aggregateMetrics(symbolReports, opts.startEquity),
    symbols: symbolReports,
  };
}

function readManifest(path: string): { symbols: { file: string }[] } {
  return JSON.parse(readFileSync(path, "utf8")) as {
    symbols: { file: string }[];
  };
}

export async function runMultiBacktestCli(): Promise<void> {
  const manifestPath = resolve(process.argv[2] ?? "data/rwa-sample/manifest.json");
  const out = resolve(process.argv[3] ?? "artifacts/rwa-multi-backtest.json");
  const manifest = readManifest(manifestPath);
  const fixtures = manifest.symbols.map((row) => {
    const fixture = JSON.parse(readFileSync(resolve(row.file), "utf8")) as CandleFixture;
    return fixture;
  });
  const slippage = resolveBacktestSlippage(
    fixtures.map((fixture) => fixture.symbol),
  );
  const report = buildMultiBacktestReport(fixtures, {
    gapThreshold: GAP_THRESHOLD,
    costPerSide: COST_PER_SIDE,
    slippageBps: slippage.slippageBps,
    slippageSource: slippage.source,
    startEquity: START_EQUITY,
  });

  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
  console.log(
    `RWA multi-backtest — ${report.aggregate.symbols} symbols, ${report.aggregate.totalTrades} trades`,
  );
  console.table({
    aggregate: {
      "return %": report.aggregate.totalReturnPct,
      "sharpe ann.": report.aggregate.sharpeAnnualized,
      "max DD %": report.aggregate.maxDrawdownPct,
      "win %": report.aggregate.winRatePct,
      trades: report.aggregate.totalTrades,
    },
  });
  console.log(`saved: ${out}`);
}

if (process.argv[1]?.endsWith("multiBacktest.ts")) {
  await runMultiBacktestCli();
}
