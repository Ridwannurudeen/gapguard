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
import { governRisk } from "./riskGovernor";
import {
  resolveExecutionAssumptions,
  type ExecutionAssumption,
  type ExecutionAssumptionSet,
} from "./slippage";

const GAP_THRESHOLD = Number(process.env.BT_GAP_THRESHOLD ?? "0.004");
const COST_PER_SIDE = Number(process.env.BT_COST ?? "0.0005");
const START_EQUITY = 1000;

export interface CandleFixture {
  symbol: string;
  granularity: string;
  candles: Candle[];
}

export interface RwaSampleManifest {
  generatedAt?: string;
  source?: string;
  granularity?: string;
  symbols: {
    symbol?: string;
    file: string;
    from?: string;
    to?: string;
    count?: number;
  }[];
}

export interface SymbolBacktest {
  symbol: string;
  interval: string;
  window: {
    from: string | undefined;
    to: string | undefined;
    sessions: number;
  };
  execution: ExecutionAssumption;
  metrics: BacktestMetrics;
  rejectedOrders: number;
  turnoverUSDT: number;
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
    executionAssumptionSource: string;
    startEquityPerSymbol: number;
  };
  aggregate: BacktestMetrics & {
    symbols: number;
    maxDrawdownMethod: string;
    portfolioTradingDays: number;
    rejectedOrders: number;
    grossExposurePct: number;
    netExposurePct: number;
    turnoverPct: number;
    cashPct: number;
  };
  symbols: SymbolBacktest[];
}

interface GovernedTrades {
  trades: Trade[];
  rejectedOrders: number;
  turnoverUSDT: number;
}

function round(value: number, digits = 3): number {
  return +value.toFixed(digits);
}

function assumptionFor(
  assumptions: ExecutionAssumptionSet,
  symbol: string,
): ExecutionAssumption {
  return assumptions.bySymbol[symbol] ?? {
    ...assumptions.fallback,
    symbol,
  };
}

function computeGovernedGapTrades(
  asset: string,
  sessions: DaySession[],
  opts: {
    gapThreshold: number;
    costPerSide: number;
    startEquity: number;
    execution: ExecutionAssumption;
  },
): GovernedTrades {
  const trades: Trade[] = [];
  let equity = opts.startEquity;
  let peak = opts.startEquity;
  let currentExposure = 0;
  let rejectedOrders = 0;
  let turnoverUSDT = 0;

  for (let i = 1; i < sessions.length; i += 1) {
    const prior = sessions[i - 1];
    const today = sessions[i];
    const gap = today.openPrice / prior.closePrice - 1;
    if (Math.abs(gap) < opts.gapThreshold) continue;

    const direction = gap > 0 ? "short" : "long";
    const governor = governRisk({
      direction: gap > 0 ? "rich" : "cheap",
      confidence: Math.min(1, Math.abs(gap) / opts.gapThreshold),
      volatility: Math.max(Math.abs(gap), 0.005),
      session: "overnight",
      underlyingOpen: false,
      equity,
      currentExposure,
      drawdownPct: peak ? (peak - equity) / peak : 0,
    });
    const targetNotional =
      governor.targetNotional * opts.execution.sizeMultiplier;
    const orderNotional = Math.abs(targetNotional - currentExposure);
    if (
      targetNotional === 0 ||
      orderNotional < opts.execution.minNotionalUSDT ||
      orderNotional / today.openPrice < opts.execution.minTradeNum
    ) {
      rejectedOrders += 1;
      continue;
    }

    const entry = today.openPrice;
    const exit = today.closePrice;
    const gross =
      direction === "short" ? (entry - exit) / entry : (exit - entry) / entry;
    const slippagePerSide = opts.execution.slippageBps / 10_000;
    const net =
      gross -
      2 * (opts.costPerSide + slippagePerSide) -
      Math.abs(opts.execution.fundingRate);
    const balanceBefore = equity;
    const tradeReturn = net * (orderNotional / equity);
    equity *= 1 + tradeReturn;
    peak = Math.max(peak, equity);
    currentExposure = 0;
    turnoverUSDT += orderNotional;

    trades.push({
      ts: today.date,
      asset,
      direction,
      gapPct: round(gap * 100),
      entryPrice: round(entry, 2),
      exitPrice: round(exit, 2),
      qty: round(orderNotional / entry, 4),
      returnPct: round(tradeReturn * 100),
      balanceBefore: round(balanceBefore, 2),
      balanceAfter: round(equity, 2),
    });
  }

  return {
    trades,
    rejectedOrders,
    turnoverUSDT: round(turnoverUSDT, 2),
  };
}

function aggregateMetrics(
  symbols: SymbolBacktest[],
  startEquityPerSymbol: number,
): BacktestMetrics & {
  symbols: number;
  maxDrawdownMethod: string;
  portfolioTradingDays: number;
  rejectedOrders: number;
  grossExposurePct: number;
  netExposurePct: number;
  turnoverPct: number;
  cashPct: number;
} {
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
  const rejectedOrders = symbols.reduce(
    (sum, symbol) => sum + symbol.rejectedOrders,
    0,
  );
  const turnoverUSDT = symbols.reduce(
    (sum, symbol) => sum + symbol.turnoverUSDT,
    0,
  );
  const dailyGrossExposure = new Map<string, number>();
  const dailyNetExposure = new Map<string, number>();
  for (const trade of trades) {
    const notional = trade.qty * trade.entryPrice;
    dailyGrossExposure.set(
      trade.ts,
      (dailyGrossExposure.get(trade.ts) ?? 0) + notional,
    );
    dailyNetExposure.set(
      trade.ts,
      (dailyNetExposure.get(trade.ts) ?? 0) +
        notional * (trade.direction === "long" ? 1 : -1),
    );
  }
  const grossExposureUSDT = Math.max(0, ...dailyGrossExposure.values());
  const netExposureUSDT = Math.max(
    0,
    ...[...dailyNetExposure.values()].map((value) => Math.abs(value)),
  );
  const profitFactor = grossLoss
    ? grossWin / grossLoss
    : grossWin > 0
      ? Infinity
      : 0;
  const dailyReturns = new Map<string, number>();
  for (const trade of trades) {
    dailyReturns.set(
      trade.ts,
      (dailyReturns.get(trade.ts) ?? 0) + trade.returnPct / 100,
    );
  }
  let portfolioEquity = startEquity;
  let peak = startEquity;
  let maxDrawdown = 0;
  for (const date of [...dailyReturns.keys()].sort()) {
    portfolioEquity *= 1 + (dailyReturns.get(date) ?? 0) / symbols.length;
    peak = Math.max(peak, portfolioEquity);
    maxDrawdown = Math.max(maxDrawdown, peak ? (peak - portfolioEquity) / peak : 0);
  }

  return {
    symbols: symbols.length,
    totalReturnPct: startEquity ? +((endingEquity / startEquity - 1) * 100).toFixed(3) : 0,
    sharpePerTrade: +sharpePerTrade.toFixed(3),
    sharpeAnnualized: +(sharpePerTrade * Math.sqrt(tradesPerYear)).toFixed(3),
    maxDrawdownPct: +(maxDrawdown * 100).toFixed(3),
    maxDrawdownMethod:
      "synchronized daily equal-weight portfolio equity curve",
    portfolioTradingDays: dailyReturns.size,
    rejectedOrders,
    grossExposurePct: startEquity
      ? +((grossExposureUSDT / startEquity) * 100).toFixed(2)
      : 0,
    netExposurePct: startEquity
      ? +((netExposureUSDT / startEquity) * 100).toFixed(2)
      : 0,
    turnoverPct: startEquity
      ? +((turnoverUSDT / startEquity) * 100).toFixed(2)
      : 0,
    cashPct: 100,
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
    executionAssumptions: ExecutionAssumptionSet;
    startEquity: number;
  },
): MultiBacktestReport {
  const symbolReports = fixtures.map((fixture) => {
    const sessions = collapseSessions(fixture.candles);
    const execution = assumptionFor(opts.executionAssumptions, fixture.symbol);
    const governed = computeGovernedGapTrades(fixture.symbol, sessions, {
      gapThreshold: opts.gapThreshold,
      costPerSide: opts.costPerSide,
      startEquity: opts.startEquity,
      execution,
    });
    return {
      symbol: fixture.symbol,
      interval: fixture.granularity,
      window: {
        from: sessions[0]?.date,
        to: sessions[sessions.length - 1]?.date,
        sessions: sessions.length,
      },
      execution,
      metrics: summarize(governed.trades, sessions, opts.startEquity),
      rejectedOrders: governed.rejectedOrders,
      turnoverUSDT: governed.turnoverUSDT,
      trades: governed.trades,
    };
  });
  const slippages = symbolReports.map((row) => row.execution.slippageBps);
  const averageSlippage = slippages.length
    ? slippages.reduce((sum, value) => sum + value, 0) / slippages.length
    : 0;

  return {
    strategy: "GapGuard multi-symbol off-hours gap reversion",
    dataSource: "public Bitget /api/v2/mix/market/history-candles (no key)",
    params: {
      gapThresholdPct: opts.gapThreshold * 100,
      costPerSidePct: opts.costPerSide * 100,
      slippagePerSideBps: +averageSlippage.toFixed(3),
      slippageSource: "per-symbol execution assumptions",
      executionAssumptionSource: opts.executionAssumptions.source,
      startEquityPerSymbol: opts.startEquity,
    },
    aggregate: aggregateMetrics(symbolReports, opts.startEquity),
    symbols: symbolReports,
  };
}

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown, path: string, field: string): UnknownRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${path}: ${field} must be an object`);
  }
  return value as UnknownRecord;
}

function readArray(value: unknown, path: string, field: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`${path}: ${field} must be an array`);
  }
  return value;
}

function readString(value: unknown, path: string, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${path}: ${field} must be a non-empty string`);
  }
  return value;
}

function optionalString(
  value: unknown,
  path: string,
  field: string,
): string | undefined {
  if (value === undefined || value === null) return undefined;
  return readString(value, path, field);
}

function optionalNumber(
  value: unknown,
  path: string,
  field: string,
): number | undefined {
  if (value === undefined || value === null) return undefined;
  return readFiniteNumber(value, path, field);
}

function readFiniteNumber(value: unknown, path: string, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${path}: ${field} must be a finite number`);
  }
  return value;
}

function parseManifestSymbol(
  value: unknown,
  path: string,
  index: number,
): RwaSampleManifest["symbols"][number] {
  const row = asRecord(value, path, `symbols[${index}]`);
  return {
    symbol: optionalString(row.symbol, path, `symbols[${index}].symbol`),
    file: readString(row.file, path, `symbols[${index}].file`),
    from: optionalString(row.from, path, `symbols[${index}].from`),
    to: optionalString(row.to, path, `symbols[${index}].to`),
    count: optionalNumber(row.count, path, `symbols[${index}].count`),
  };
}

function parseCandle(value: unknown, path: string, index: number): Candle {
  const row = asRecord(value, path, `candles[${index}]`);
  return {
    ts: readFiniteNumber(row.ts, path, `candles[${index}].ts`),
    open: readFiniteNumber(row.open, path, `candles[${index}].open`),
    high: readFiniteNumber(row.high, path, `candles[${index}].high`),
    low: readFiniteNumber(row.low, path, `candles[${index}].low`),
    close: readFiniteNumber(row.close, path, `candles[${index}].close`),
    volume: readFiniteNumber(row.volume, path, `candles[${index}].volume`),
  };
}

export function loadRwaSampleManifest(path: string): RwaSampleManifest {
  const doc = asRecord(JSON.parse(readFileSync(path, "utf8")) as unknown, path, "$");
  return {
    generatedAt: optionalString(doc.generatedAt, path, "generatedAt"),
    source: optionalString(doc.source, path, "source"),
    granularity: optionalString(doc.granularity, path, "granularity"),
    symbols: readArray(doc.symbols, path, "symbols").map((row, index) =>
      parseManifestSymbol(row, path, index),
    ),
  };
}

export function loadCandleFixture(path: string): CandleFixture {
  const doc = asRecord(JSON.parse(readFileSync(path, "utf8")) as unknown, path, "$");
  return {
    symbol: readString(doc.symbol, path, "symbol"),
    granularity: readString(doc.granularity, path, "granularity"),
    candles: readArray(doc.candles, path, "candles").map((row, index) =>
      parseCandle(row, path, index),
    ),
  };
}

export async function runMultiBacktestCli(): Promise<void> {
  const manifestPath = resolve(process.argv[2] ?? "data/rwa-sample/manifest.json");
  const out = resolve(process.argv[3] ?? "artifacts/rwa-multi-backtest.json");
  const manifest = loadRwaSampleManifest(manifestPath);
  const fixtures = manifest.symbols.map((row) =>
    loadCandleFixture(resolve(row.file)),
  );
  const executionAssumptions = resolveExecutionAssumptions(
    fixtures.map((fixture) => fixture.symbol),
  );
  const report = buildMultiBacktestReport(fixtures, {
    gapThreshold: GAP_THRESHOLD,
    costPerSide: COST_PER_SIDE,
    executionAssumptions,
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
