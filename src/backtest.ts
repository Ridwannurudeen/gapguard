// GapGuard backtest — deterministic off-hours gap reversion on the tokenized
// US-stock perp AAPLUSDT, using REAL public Bitget candles (no API key) and the
// project's own US-session clock. No LLM in the backtested path.
//
//   npm run backtest            # uses data/aaplusdt-1h.json
//
// Thesis: a tokenized stock trades 24/7 but the underlying US market is open
// ~6.5h/weekday. The off-hours move (prior US close -> next US open) tends to
// partially revert during the regular session. We fade an outsized overnight
// gap at the session open and exit at the session close. Reproducible: the
// candle fixture is committed; regenerate with `node scripts/fetch-aaplusdt.mjs`.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  collapseSessions,
  computeGapTrades,
  summarize,
  type Candle,
} from "./gapEngine";

const GAP_THRESHOLD = Number(process.env.BT_GAP_THRESHOLD ?? "0.004"); // fade gaps >= 0.4%
const COST_PER_SIDE = Number(process.env.BT_COST ?? "0.0005"); // 5 bps fee+slippage each side
const START_EQUITY = 1000;

const file = resolve(process.argv[2] ?? "data/aaplusdt-1h.json");
const fixture = JSON.parse(readFileSync(file, "utf8")) as {
  symbol: string;
  granularity: string;
  candles: Candle[];
};
const { symbol, candles } = fixture;

const sessions = collapseSessions(candles);
const trades = computeGapTrades(symbol, sessions, {
  gapThreshold: GAP_THRESHOLD,
  costPerSide: COST_PER_SIDE,
  startEquity: START_EQUITY,
});
const metrics = summarize(trades, sessions, START_EQUITY);

const report = {
  strategy: "GapGuard off-hours gap reversion",
  asset: symbol,
  interval: fixture.granularity,
  dataSource: "public Bitget /api/v2/mix/market/candles (no key)",
  window: {
    from: sessions[0]?.date,
    to: sessions[sessions.length - 1]?.date,
    sessions: sessions.length,
  },
  params: {
    gapThresholdPct: GAP_THRESHOLD * 100,
    costPerSidePct: COST_PER_SIDE * 100,
    startEquity: START_EQUITY,
  },
  metrics,
  trades,
};

const out = resolve("artifacts/aaplusdt-backtest.json");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);

console.log(
  `\nGapGuard backtest — ${symbol} ${fixture.granularity} (${report.window.from} -> ${report.window.to}, ${report.window.sessions} sessions)`,
);
console.log(
  "  data: real public Bitget candles, no API key; no LLM in the backtested path",
);
console.table({
  "Total return %": metrics.totalReturnPct,
  "Sharpe (annualized)": metrics.sharpeAnnualized,
  "Max drawdown %": metrics.maxDrawdownPct,
  "Win rate %": metrics.winRatePct,
  "Total trades": metrics.totalTrades,
  "Profit factor": metrics.profitFactor,
});
console.log(`saved report + per-trade log: ${out}`);
