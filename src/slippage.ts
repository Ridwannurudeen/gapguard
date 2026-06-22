import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { RwaMarketReport, RwaMarketRow } from "./rwa-market";

export interface SlippageConfig {
  slippageBps: number;
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
