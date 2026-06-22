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
import { classifySession } from "./marketClock";

interface Candle {
  ts: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface Trade {
  ts: string;
  asset: string;
  direction: "long" | "short";
  gapPct: number;
  entryPrice: number;
  exitPrice: number;
  qty: number;
  returnPct: number;
  balanceBefore: number;
  balanceAfter: number;
}

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

// Collapse the hourly bars into regular US-session days (open price = first
// regular-session bar's open ~09:30 ET, close price = last regular bar's close ~16:00 ET).
interface DaySession {
  date: string;
  openPrice: number;
  closePrice: number;
}
const sessions: DaySession[] = [];
let cur: { date: string; first: Candle; last: Candle } | null = null;
for (const c of candles) {
  const s = classifySession(new Date(c.ts));
  if (!s.underlyingOpen) continue;
  const date = s.etTime.slice(0, 10);
  if (!cur || cur.date !== date) {
    if (cur)
      sessions.push({
        date: cur.date,
        openPrice: cur.first.open,
        closePrice: cur.last.close,
      });
    cur = { date, first: c, last: c };
  } else {
    cur.last = c;
  }
}
if (cur)
  sessions.push({
    date: cur.date,
    openPrice: cur.first.open,
    closePrice: cur.last.close,
  });

const trades: Trade[] = [];
let equity = START_EQUITY;
for (let i = 1; i < sessions.length; i += 1) {
  const prior = sessions[i - 1];
  const today = sessions[i];
  const gap = today.openPrice / prior.closePrice - 1;
  if (Math.abs(gap) < GAP_THRESHOLD) continue;
  const direction: "long" | "short" = gap > 0 ? "short" : "long";
  const entry = today.openPrice;
  const exit = today.closePrice;
  const gross =
    direction === "short" ? (entry - exit) / entry : (exit - entry) / entry;
  const net = gross - 2 * COST_PER_SIDE;
  const balanceBefore = equity;
  equity *= 1 + net;
  trades.push({
    ts: today.date,
    asset: symbol,
    direction,
    gapPct: +(gap * 100).toFixed(3),
    entryPrice: +entry.toFixed(2),
    exitPrice: +exit.toFixed(2),
    qty: +(balanceBefore / entry).toFixed(4),
    returnPct: +(net * 100).toFixed(3),
    balanceBefore: +balanceBefore.toFixed(2),
    balanceAfter: +equity.toFixed(2),
  });
}

const rets = trades.map((t) => t.returnPct / 100);
const n = rets.length;
const totalReturnPct = (equity / START_EQUITY - 1) * 100;
const wins = rets.filter((r) => r > 0);
const losses = rets.filter((r) => r <= 0);
const winRatePct = n ? (wins.length / n) * 100 : 0;
const mean = n ? rets.reduce((a, b) => a + b, 0) / n : 0;
const sd =
  n > 1
    ? Math.sqrt(rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1))
    : 0;
const sharpePerTrade = sd ? mean / sd : 0;
const spanDays =
  sessions.length > 1
    ? (new Date(`${sessions[sessions.length - 1].date}T00:00:00Z`).getTime() -
        new Date(`${sessions[0].date}T00:00:00Z`).getTime()) /
      86_400_000
    : 0;
const tradesPerYear = spanDays > 0 ? n / (spanDays / 365) : 0;
const sharpeAnnualized = sharpePerTrade * Math.sqrt(Math.max(tradesPerYear, 0));
const grossWin = wins.reduce((a, b) => a + b, 0);
const grossLoss = Math.abs(losses.reduce((a, b) => a + b, 0));
const profitFactor = grossLoss
  ? grossWin / grossLoss
  : grossWin > 0
    ? Infinity
    : 0;

let peak = START_EQUITY;
let maxDDPct = 0;
for (const t of trades) {
  if (t.balanceAfter > peak) peak = t.balanceAfter;
  const dd = ((peak - t.balanceAfter) / peak) * 100;
  if (dd > maxDDPct) maxDDPct = dd;
}

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
  metrics: {
    totalReturnPct: +totalReturnPct.toFixed(3),
    sharpePerTrade: +sharpePerTrade.toFixed(3),
    sharpeAnnualized: +sharpeAnnualized.toFixed(3),
    maxDrawdownPct: +maxDDPct.toFixed(3),
    winRatePct: +winRatePct.toFixed(1),
    totalTrades: n,
    profitFactor: Number.isFinite(profitFactor)
      ? +profitFactor.toFixed(2)
      : null,
    endingEquity: +equity.toFixed(2),
  },
  trades,
};

const out = resolve("artifacts/aaplusdt-backtest.json");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);

const m = report.metrics;
console.log(
  `\nGapGuard backtest — ${symbol} ${fixture.granularity} (${report.window.from} -> ${report.window.to}, ${report.window.sessions} sessions)`,
);
console.log(
  "  data: real public Bitget candles, no API key; no LLM in the backtested path",
);
console.table({
  "Total return %": m.totalReturnPct,
  "Sharpe (annualized)": m.sharpeAnnualized,
  "Max drawdown %": m.maxDrawdownPct,
  "Win rate %": m.winRatePct,
  "Total trades": m.totalTrades,
  "Profit factor": m.profitFactor,
});
console.log(`saved report + per-trade log: ${out}`);
