// Shared, deterministic off-hours gap-reversion engine for the AAPLUSDT backtests.
// No LLM, no network. Both the always-fade baseline (`backtest.ts`) and the
// news-aware variant (`newsBacktest.ts`) run through these functions so their
// math is identical and the only difference is which gaps the agent stands aside on.

import { classifySession } from "./marketClock";

export interface Candle {
  ts: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface DaySession {
  date: string;
  openPrice: number;
  closePrice: number;
}

export interface Trade {
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

export interface BacktestMetrics {
  totalReturnPct: number;
  sharpePerTrade: number;
  sharpeAnnualized: number;
  maxDrawdownPct: number;
  winRatePct: number;
  totalTrades: number;
  profitFactor: number | null;
  endingEquity: number;
}

export interface RunOptions {
  gapThreshold: number;
  costPerSide: number;
  startEquity: number;
  /** Return true to STAND ASIDE on this session's gap (e.g. a confirmed catalyst). */
  skip?: (date: string) => boolean;
}

// Collapse hourly bars into regular US-session days: open = first regular-session
// bar's open (~09:30 ET), close = last regular bar's close (~16:00 ET).
export function collapseSessions(candles: Candle[]): DaySession[] {
  const sessions: DaySession[] = [];
  let cur: { date: string; first: Candle; last: Candle } | null = null;
  for (const c of candles) {
    const s = classifySession(new Date(c.ts));
    if (!s.underlyingOpen) continue;
    const date = s.etTime.slice(0, 10);
    if (!cur || cur.date !== date) {
      if (cur) {
        sessions.push({
          date: cur.date,
          openPrice: cur.first.open,
          closePrice: cur.last.close,
        });
      }
      cur = { date, first: c, last: c };
    } else {
      cur.last = c;
    }
  }
  if (cur) {
    sessions.push({
      date: cur.date,
      openPrice: cur.first.open,
      closePrice: cur.last.close,
    });
  }
  return sessions;
}

export function computeGapTrades(
  asset: string,
  sessions: DaySession[],
  opts: RunOptions,
): Trade[] {
  const trades: Trade[] = [];
  let equity = opts.startEquity;
  for (let i = 1; i < sessions.length; i += 1) {
    const prior = sessions[i - 1];
    const today = sessions[i];
    const gap = today.openPrice / prior.closePrice - 1;
    if (Math.abs(gap) < opts.gapThreshold) continue;
    if (opts.skip?.(today.date)) continue; // stand aside on a justified move
    const direction: "long" | "short" = gap > 0 ? "short" : "long";
    const entry = today.openPrice;
    const exit = today.closePrice;
    const gross =
      direction === "short" ? (entry - exit) / entry : (exit - entry) / entry;
    const net = gross - 2 * opts.costPerSide;
    const balanceBefore = equity;
    equity *= 1 + net;
    trades.push({
      ts: today.date,
      asset,
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
  return trades;
}

export function summarize(
  trades: Trade[],
  sessions: DaySession[],
  startEquity: number,
): BacktestMetrics {
  const rets = trades.map((t) => t.returnPct / 100);
  const n = rets.length;
  const endingEquity = trades.length
    ? trades[trades.length - 1].balanceAfter
    : startEquity;
  const totalReturnPct = (endingEquity / startEquity - 1) * 100;
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
  const sharpeAnnualized =
    sharpePerTrade * Math.sqrt(Math.max(tradesPerYear, 0));
  const grossWin = wins.reduce((a, b) => a + b, 0);
  const grossLoss = Math.abs(losses.reduce((a, b) => a + b, 0));
  const profitFactor = grossLoss
    ? grossWin / grossLoss
    : grossWin > 0
      ? Infinity
      : 0;

  let peak = startEquity;
  let maxDDPct = 0;
  for (const t of trades) {
    if (t.balanceAfter > peak) peak = t.balanceAfter;
    const dd = ((peak - t.balanceAfter) / peak) * 100;
    if (dd > maxDDPct) maxDDPct = dd;
  }

  return {
    totalReturnPct: +totalReturnPct.toFixed(3),
    sharpePerTrade: +sharpePerTrade.toFixed(3),
    sharpeAnnualized: +sharpeAnnualized.toFixed(3),
    maxDrawdownPct: +maxDDPct.toFixed(3),
    winRatePct: +winRatePct.toFixed(1),
    totalTrades: n,
    profitFactor: Number.isFinite(profitFactor)
      ? +profitFactor.toFixed(2)
      : null,
    endingEquity: +endingEquity.toFixed(2),
  };
}
