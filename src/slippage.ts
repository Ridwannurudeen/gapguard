import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { RwaMarketReport, RwaMarketRow } from "./rwa-market";

export interface SlippageConfig {
  slippageBps: number;
  source: string;
}

export interface ExecutionAssumption {
  symbol: string;
  slippageBps: number;
  fundingRate: number;
  minTradeNum: number;
  sizeMultiplier: number;
  minNotionalUSDT: number;
  source: string;
}

export interface ExecutionAssumptionSet {
  bySymbol: Record<string, ExecutionAssumption>;
  fallback: ExecutionAssumption;
  source: string;
}

function readNumber(value: string | undefined): number | null {
  if (value === undefined || value.length === 0) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function spreadRows(report: RwaMarketReport): RwaMarketRow[] {
  return report.rows.filter(
    (row) => row.spreadBps !== null && Number.isFinite(row.spreadBps),
  );
}

function defaultExecutionAssumption(symbol: string, source: string): ExecutionAssumption {
  return {
    symbol,
    slippageBps: 0,
    fundingRate: 0,
    minTradeNum: 0,
    sizeMultiplier: 0.01,
    minNotionalUSDT: 0,
    source,
  };
}

function assumptionFromRow(row: RwaMarketRow, marketPath: string): ExecutionAssumption {
  return {
    symbol: row.symbol,
    slippageBps:
      row.spreadBps !== null && Number.isFinite(row.spreadBps)
        ? +(row.spreadBps / 2).toFixed(4)
        : 0,
    fundingRate:
      row.fundingRate !== null && Number.isFinite(row.fundingRate)
        ? row.fundingRate
        : 0,
    minTradeNum: row.minTradeNum,
    sizeMultiplier: row.sizeMultiplier,
    minNotionalUSDT: row.suggestedNotionalUSDT ?? row.minTradeUSDT,
    source: `${marketPath} row ${row.symbol}`,
  };
}

export function resolveBacktestSlippage(
  symbols: string[],
  env: NodeJS.ProcessEnv = process.env,
  marketPath = env.RWA_MARKET_PATH ?? "public/rwa-market.json",
): SlippageConfig {
  const override = readNumber(env.BT_SLIPPAGE_BPS);
  if (override !== null) {
    return {
      slippageBps: override,
      source: "BT_SLIPPAGE_BPS override",
    };
  }

  const path = resolve(marketPath);
  if (!existsSync(path)) {
    return {
      slippageBps: 0,
      source: "no RWA market spread report found",
    };
  }

  const report = JSON.parse(readFileSync(path, "utf8")) as RwaMarketReport;
  const rows = spreadRows(report);
  if (rows.length === 0) {
    return {
      slippageBps: 0,
      source: "RWA market report has no bid/ask spreads",
    };
  }

  const matched = rows.filter((row) => symbols.includes(row.symbol));
  const basis = matched.length > 0 ? matched : rows;
  const halfSpreadBps = median(
    basis.map((row) => (row.spreadBps as number) / 2),
  );

  return {
    slippageBps: +halfSpreadBps.toFixed(4),
    source:
      matched.length > 0
        ? `median half-spread from ${marketPath} for ${matched.map((row) => row.symbol).join(", ")}`
        : `median half-spread from ${marketPath} RWA basket fallback`,
  };
}

export function resolveExecutionAssumptions(
  symbols: string[],
  env: NodeJS.ProcessEnv = process.env,
  marketPath = env.RWA_MARKET_PATH ?? "public/rwa-market.json",
): ExecutionAssumptionSet {
  const override = readNumber(env.BT_SLIPPAGE_BPS);
  const path = resolve(marketPath);
  if (!existsSync(path)) {
    const fallback = defaultExecutionAssumption(
      "FALLBACK",
      "no RWA market spread report found",
    );
    return {
      fallback,
      bySymbol: Object.fromEntries(
        symbols.map((symbol) => [
          symbol,
          { ...fallback, symbol, source: fallback.source },
        ]),
      ),
      source: fallback.source,
    };
  }

  const report = JSON.parse(readFileSync(path, "utf8")) as RwaMarketReport;
  const rows = spreadRows(report);
  const fallbackSlippage =
    override ??
    (rows.length
      ? +median(rows.map((row) => (row.spreadBps as number) / 2)).toFixed(4)
      : 0);
  const fallback = {
    ...defaultExecutionAssumption(
      "FALLBACK",
      `${marketPath} RWA basket fallback`,
    ),
    slippageBps: fallbackSlippage,
  };
  const rowBySymbol = new Map(
    report.rows.map((row) => [row.symbol, assumptionFromRow(row, marketPath)]),
  );
  const bySymbol: Record<string, ExecutionAssumption> = {};
  for (const symbol of symbols) {
    const assumption = rowBySymbol.get(symbol);
    bySymbol[symbol] = assumption
      ? {
          ...assumption,
          slippageBps: override ?? assumption.slippageBps,
          source: override
            ? `BT_SLIPPAGE_BPS override + ${assumption.source}`
            : assumption.source,
        }
      : { ...fallback, symbol };
  }

  return {
    bySymbol,
    fallback,
    source: override
      ? `BT_SLIPPAGE_BPS override with funding/min-size from ${marketPath}`
      : `symbol-specific half-spread, funding, and min-size from ${marketPath}`,
  };
}
