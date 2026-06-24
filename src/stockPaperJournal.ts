import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { collapseSessions, computeGapTrades, type Candle } from "./gapEngine";
import {
  gateStandAsideDates,
  loadGateVerdicts,
  type GateVerdictCache,
} from "./gateVerdicts";

export type StockPaperAction = "FADE" | "FOLLOW" | "STAND_ASIDE";

export interface StockPaperJournalRow {
  evidenceLabel: "SIMULATED/PAPER_STOCK";
  timestamp: string;
  asset: string;
  action: StockPaperAction;
  direction: "long" | "short" | "flat";
  priceType: "entry";
  price: number;
  entryPrice: number;
  markPrice: number;
  quantity: number;
  pnl: number;
  accountBalanceChange: number;
  accountBalanceBefore: number;
  accountBalanceAfter: number;
  naiveAction: "FADE";
  naiveDirection: "long" | "short";
  naivePnl: number;
  naiveReturnPct: number;
  source: string;
  rationale: string;
}

export interface JournalAssetInput {
  symbol: string;
  candles: Candle[];
  gapThreshold: number;
  costPerSide: number;
  slippageBps: number;
  startEquity: number;
  gateCache: GateVerdictCache | null;
  source: string;
}

interface CandleFixture {
  symbol: string;
  candles: Candle[];
}

function round(value: number, digits = 2): number {
  return +value.toFixed(digits);
}

function oppositeDirection(direction: "long" | "short"): "long" | "short" {
  return direction === "long" ? "short" : "long";
}

function followReturnPct(
  fadeReturnPct: number,
  costPerSide: number,
  slippageBps: number,
): number {
  const totalCostPct = 2 * (costPerSide + slippageBps / 10_000) * 100;
  return +(-fadeReturnPct - 2 * totalCostPct).toFixed(3);
}

function buildRowsForAsset(input: JournalAssetInput): StockPaperJournalRow[] {
  const sessions = collapseSessions(input.candles);
  const trades = computeGapTrades(input.symbol, sessions, {
    gapThreshold: input.gapThreshold,
    costPerSide: input.costPerSide,
    slippageBps: input.slippageBps,
    startEquity: input.startEquity,
  });
  const standAsideDates = input.gateCache
    ? gateStandAsideDates(input.gateCache)
    : new Set<string>();
  const verdictsByDate = new Map(
    input.gateCache?.verdicts.map((v) => [v.date, v]) ?? [],
  );
  let balance = input.startEquity;

  return trades.map((trade) => {
    const balanceBefore = balance;
    const verdict = verdictsByDate.get(trade.ts);
    const action = standAsideDates.has(trade.ts)
      ? "STAND_ASIDE"
      : (verdict?.action ?? "FADE");
    const returnPct =
      action === "FOLLOW"
        ? followReturnPct(trade.returnPct, input.costPerSide, input.slippageBps)
        : trade.returnPct;
    const pnl =
      action === "STAND_ASIDE" ? 0 : round(balanceBefore * (returnPct / 100));
    balance = round(balanceBefore + pnl);
    const rationale = action === "STAND_ASIDE"
      ? (verdict?.rationale ?? "Gate vetoed the trade.")
      : (verdict?.rationale ??
        "No gate veto is available for this simulated stock-paper row.");

    return {
      evidenceLabel: "SIMULATED/PAPER_STOCK",
      timestamp: `${trade.ts}T13:30:00.000Z`,
      asset: trade.asset,
      action,
      direction:
        action === "STAND_ASIDE"
          ? "flat"
          : action === "FOLLOW"
            ? oppositeDirection(trade.direction)
            : trade.direction,
      priceType: "entry",
      price: trade.entryPrice,
      entryPrice: trade.entryPrice,
      markPrice: trade.exitPrice,
      quantity:
        action === "STAND_ASIDE" ? 0 : round(balanceBefore / trade.entryPrice, 4),
      pnl,
      accountBalanceChange: pnl,
      accountBalanceBefore: round(balanceBefore),
      accountBalanceAfter: balance,
      naiveAction: "FADE",
      naiveDirection: trade.direction,
      naivePnl: round(trade.balanceAfter - trade.balanceBefore),
      naiveReturnPct: trade.returnPct,
      source: input.source,
      rationale,
    };
  });
}

export function buildStockPaperJournal(
  inputs: JournalAssetInput[],
): StockPaperJournalRow[] {
  return inputs.flatMap(buildRowsForAsset);
}

function escapeCsv(value: string | number): string {
  const raw = String(value);
  return /[",\r\n]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw;
}

export function toCsv(rows: StockPaperJournalRow[]): string {
  const columns: (keyof StockPaperJournalRow)[] = [
    "evidenceLabel",
    "timestamp",
    "asset",
    "action",
    "direction",
    "priceType",
    "price",
    "entryPrice",
    "markPrice",
    "quantity",
    "pnl",
    "accountBalanceChange",
    "accountBalanceBefore",
    "accountBalanceAfter",
    "naiveAction",
    "naiveDirection",
    "naivePnl",
    "naiveReturnPct",
    "source",
    "rationale",
  ];
  return `${columns.join(",")}\n${rows
    .map((row) => columns.map((column) => escapeCsv(row[column])).join(","))
    .join("\n")}\n`;
}

function readFixture(path: string): CandleFixture {
  return JSON.parse(readFileSync(path, "utf8")) as CandleFixture;
}

export function runStockPaperJournalCli(): void {
  const newsBacktest = JSON.parse(
    readFileSync(
      resolve("artifacts/aaplusdt-news-aware-backtest.json"),
      "utf8",
    ),
  ) as {
    params: {
      gapThresholdPct: number;
      costPerSidePct: number;
      slippagePerSideBps: number;
      startEquity: number;
    };
  };
  const multi = JSON.parse(
    readFileSync(resolve("artifacts/rwa-multi-backtest.json"), "utf8"),
  ) as {
    params: {
      gapThresholdPct: number;
      costPerSidePct: number;
      slippagePerSideBps: number;
      startEquityPerSymbol: number;
    };
  };
  const aapl = readFixture(resolve("data/aaplusdt-1h.json"));
  const nvda = readFixture(resolve("data/rwa-sample/nvdausdt-1h.json"));
  const gateCache = loadGateVerdicts(
    resolve("data/aaplusdt-gate-verdicts.json"),
  );
  const rows = buildStockPaperJournal([
    {
      symbol: aapl.symbol,
      candles: aapl.candles,
      gapThreshold: newsBacktest.params.gapThresholdPct / 100,
      costPerSide: newsBacktest.params.costPerSidePct / 100,
      slippageBps: newsBacktest.params.slippagePerSideBps,
      startEquity: newsBacktest.params.startEquity,
      gateCache,
      source:
        "artifacts/aaplusdt-news-aware-backtest.json + data/aaplusdt-gate-verdicts.json",
    },
    {
      symbol: nvda.symbol,
      candles: nvda.candles,
      gapThreshold: multi.params.gapThresholdPct / 100,
      costPerSide: multi.params.costPerSidePct / 100,
      slippageBps: multi.params.slippagePerSideBps,
      startEquity: multi.params.startEquityPerSymbol,
      gateCache: null,
      source:
        "artifacts/rwa-multi-backtest.json baseline; no NVDA Qwen gate cache",
    },
  ]);
  const jsonlOut = resolve(
    process.argv[2] ?? "artifacts/stock-paper-journal.jsonl",
  );
  const csvOut = resolve(
    process.argv[3] ?? "artifacts/stock-paper-journal.csv",
  );
  mkdirSync(dirname(jsonlOut), { recursive: true });
  mkdirSync(dirname(csvOut), { recursive: true });
  writeFileSync(
    jsonlOut,
    `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`,
  );
  writeFileSync(csvOut, toCsv(rows));
  console.log(
    `stock paper journal: ${rows.length} rows (${jsonlOut}, ${csvOut})`,
  );
}

if (process.argv[1]?.endsWith("stockPaperJournal.ts")) {
  runStockPaperJournalCli();
}
