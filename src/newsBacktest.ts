// GapGuard news-aware backtest — same deterministic gap engine as backtest.ts,
// but the agent STANDS ASIDE on sessions whose overnight move reflects a verified
// scheduled catalyst (e.g. the WWDC keynote) instead of blindly fading it.
//
// This is the deterministic, label-grounded view of GapGuard's core thesis: the
// edge is not fading every gap (that's ~flat) but judging which gaps are *justified
// repricing* and standing aside. Catalysts are real and dated
// (data/aaplusdt-catalysts.json, verified against Apple/Fed/BLS sources); the live
// agent produces these fade-vs-justified calls with the Qwen convergence gate.
//
//   npm run backtest:news

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  collapseSessions,
  computeGapTrades,
  summarize,
  type Candle,
} from "./gapEngine";

const GAP_THRESHOLD = Number(process.env.BT_GAP_THRESHOLD ?? "0.004");
const COST_PER_SIDE = Number(process.env.BT_COST ?? "0.0005");
const START_EQUITY = 1000;

interface Catalyst {
  date: string;
  type: string;
  weight: string;
  description: string;
  confidence: string;
  source: string;
}

const candleFile = resolve(process.argv[2] ?? "data/aaplusdt-1h.json");
const catalystFile = resolve(process.argv[3] ?? "data/aaplusdt-catalysts.json");
const fixture = JSON.parse(readFileSync(candleFile, "utf8")) as {
  symbol: string;
  granularity: string;
  candles: Candle[];
};
const catalystDoc = JSON.parse(readFileSync(catalystFile, "utf8")) as {
  catalysts: Catalyst[];
};
const { symbol, candles } = fixture;
const catalysts = catalystDoc.catalysts;

const aaplDates = new Set(
  catalysts.filter((c) => c.type === "aapl_event").map((c) => c.date),
);
const allDates = new Set(catalysts.map((c) => c.date));

const sessions = collapseSessions(candles);
const run = (skip?: (d: string) => boolean) => {
  const trades = computeGapTrades(symbol, sessions, {
    gapThreshold: GAP_THRESHOLD,
    costPerSide: COST_PER_SIDE,
    startEquity: START_EQUITY,
    skip,
  });
  return { trades, metrics: summarize(trades, sessions, START_EQUITY) };
};

const baseline = run();
const aaplAware = run((d) => aaplDates.has(d));
const allAware = run((d) => allDates.has(d));

// Which baseline trades landed on a catalyst (i.e. what the news-aware agent skipped)?
const skippedAapl = baseline.trades.filter((t) => aaplDates.has(t.ts));
const skippedAll = baseline.trades.filter((t) => allDates.has(t.ts));

const report = {
  strategy: "GapGuard news-aware gap reversion",
  asset: symbol,
  interval: fixture.granularity,
  window: {
    from: sessions[0]?.date,
    to: sessions[sessions.length - 1]?.date,
    sessions: sessions.length,
  },
  catalysts,
  variants: {
    alwaysFade: baseline.metrics,
    aaplNewsAware: aaplAware.metrics,
    allCatalystAware: allAware.metrics,
  },
  skippedOnCatalyst: {
    aapl: skippedAapl.map((t) => ({ date: t.ts, returnPct: t.returnPct })),
    all: skippedAll.map((t) => ({ date: t.ts, returnPct: t.returnPct })),
  },
  honesty: `n=${baseline.metrics.totalTrades} trades over ~6 weeks; the news-aware lift is driven mainly by standing aside on the WWDC keynote reaction (2026-06-09). Illustrative of the mechanism, not statistically significant. Labels are verified scheduled catalysts; the live agent produces these calls with the Qwen convergence gate.`,
};

const out = resolve("artifacts/aaplusdt-news-aware-backtest.json");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);

console.log(
  `\nGapGuard news-aware backtest — ${symbol} (${report.window.from} -> ${report.window.to})`,
);
console.table({
  "always-fade (baseline)": {
    "return %": baseline.metrics.totalReturnPct,
    trades: baseline.metrics.totalTrades,
    "win %": baseline.metrics.winRatePct,
  },
  "AAPL-news-aware": {
    "return %": aaplAware.metrics.totalReturnPct,
    trades: aaplAware.metrics.totalTrades,
    "win %": aaplAware.metrics.winRatePct,
  },
  "all-catalyst-aware": {
    "return %": allAware.metrics.totalReturnPct,
    trades: allAware.metrics.totalTrades,
    "win %": allAware.metrics.winRatePct,
  },
});
console.log(
  "  stood aside (AAPL events):",
  skippedAapl
    .map((t) => `${t.ts} ${t.returnPct > 0 ? "+" : ""}${t.returnPct}%`)
    .join(", ") || "none",
);
console.log(`saved: ${out}`);
