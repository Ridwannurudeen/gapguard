import {
  collapseSessions,
  computeGapTrades,
  summarize,
  type BacktestMetrics,
  type Candle,
  type Trade,
} from "./gapEngine";
import {
  gateStandAsideDates,
  type GateVerdictCache,
} from "./gateVerdicts";

export interface Catalyst {
  date: string;
  type: string;
  weight: string;
  description: string;
  confidence: string;
  source: string;
}

export interface NewsBacktestReport {
  strategy: string;
  asset: string;
  interval: string;
  window: {
    from: string | undefined;
    to: string | undefined;
    sessions: number;
  };
  catalysts: Catalyst[];
  params: {
    gapThresholdPct: number;
    costPerSidePct: number;
    slippagePerSideBps: number;
    slippageSource: string;
    startEquity: number;
  };
  variants: {
    alwaysFade: BacktestMetrics;
    alwaysFollow: BacktestMetrics;
    gateDriven: BacktestMetrics | null;
    aaplNewsAware: BacktestMetrics;
    allCatalystAware: BacktestMetrics;
  };
  gateVerdictCache:
    | {
        path: string;
        model: string;
        promptSource: string | undefined;
        generatedAt: string | undefined;
        standAsideDates: string[];
        followDates: string[];
      }
    | {
        path: string;
        status: string;
      };
  skippedOnCatalyst: {
    aapl: { date: string; returnPct: number }[];
    all: { date: string; returnPct: number }[];
    gate: { date: string; returnPct: number }[];
  };
  honesty: string;
}

function oppositeDirection(direction: Trade["direction"]): Trade["direction"] {
  return direction === "long" ? "short" : "long";
}

function followReturnPct(trade: Trade, costPerSide: number, slippageBps: number): number {
  const totalCostPct = 2 * (costPerSide + slippageBps / 10_000) * 100;
  return +(-trade.returnPct - 2 * totalCostPct).toFixed(3);
}

function applyReturns(trades: Trade[], startEquity: number): Trade[] {
  let balance = startEquity;
  return trades.map((trade) => {
    const balanceBefore = +balance.toFixed(2);
    balance *= 1 + trade.returnPct / 100;
    const balanceAfter = +balance.toFixed(2);
    return {
      ...trade,
      balanceBefore,
      balanceAfter,
      qty: +(balanceBefore / trade.entryPrice).toFixed(4),
    };
  });
}

export function buildNewsBacktestReport(params: {
  symbol: string;
  interval: string;
  candles: Candle[];
  catalysts: Catalyst[];
  gapThreshold: number;
  costPerSide: number;
  slippageBps: number;
  slippageSource: string;
  startEquity: number;
  gateVerdictPath: string;
  gateCache: GateVerdictCache | null;
}): NewsBacktestReport {
  const aaplDates = new Set(
    params.catalysts
      .filter((c) => c.type === "aapl_event")
      .map((c) => c.date),
  );
  const allDates = new Set(params.catalysts.map((c) => c.date));
  const gateStandAside = params.gateCache
    ? gateStandAsideDates(params.gateCache)
    : null;
  const gateActionByDate = params.gateCache
    ? new Map(params.gateCache.verdicts.map((v) => [v.date, v.action]))
    : null;

  const sessions = collapseSessions(params.candles);
  const run = (skip?: (d: string) => boolean) => {
    const trades = computeGapTrades(params.symbol, sessions, {
      gapThreshold: params.gapThreshold,
      costPerSide: params.costPerSide,
      slippageBps: params.slippageBps,
      startEquity: params.startEquity,
      skip,
    });
    return {
      trades,
      metrics: summarize(trades, sessions, params.startEquity),
    };
  };

  const baseline = run();
  const alwaysFollowTrades = applyReturns(
    baseline.trades.map((trade) => ({
      ...trade,
      direction: oppositeDirection(trade.direction),
      returnPct: followReturnPct(
        trade,
        params.costPerSide,
        params.slippageBps,
      ),
    })),
    params.startEquity,
  );
  const alwaysFollow = {
    trades: alwaysFollowTrades,
    metrics: summarize(alwaysFollowTrades, sessions, params.startEquity),
  };
  const aaplAware = run((d) => aaplDates.has(d));
  const allAware = run((d) => allDates.has(d));
  const gateDriven = gateActionByDate
    ? (() => {
        const selected = applyReturns(
          baseline.trades
            .map((trade) => {
              const action = gateActionByDate.get(trade.ts) ?? "FADE";
              if (action === "STAND_ASIDE") return null;
              if (action === "FOLLOW") {
                return {
                  ...trade,
                  direction: oppositeDirection(trade.direction),
                  returnPct: followReturnPct(
                    trade,
                    params.costPerSide,
                    params.slippageBps,
                  ),
                };
              }
              return trade;
            })
            .filter((trade): trade is Trade => trade !== null),
          params.startEquity,
        );
        return {
          trades: selected,
          metrics: summarize(selected, sessions, params.startEquity),
        };
      })()
    : null;
  const skipped = (trades: Trade[]) =>
    trades.map((t) => ({ date: t.ts, returnPct: t.returnPct }));
  const skippedAapl = baseline.trades.filter((t) => aaplDates.has(t.ts));
  const skippedAll = baseline.trades.filter((t) => allDates.has(t.ts));
  const skippedGate = gateStandAside
    ? baseline.trades.filter((t) => gateStandAside.has(t.ts))
    : [];
  const gateStandAsideDatesSorted = gateStandAside
    ? [...gateStandAside].sort()
    : [];
  const gateFollowDatesSorted = params.gateCache
    ? params.gateCache.verdicts
        .filter((v) => v.action === "FOLLOW")
        .map((v) => v.date)
        .sort()
    : [];

  return {
    strategy: "GapGuard news-aware gap reversion",
    asset: params.symbol,
    interval: params.interval,
    window: {
      from: sessions[0]?.date,
      to: sessions[sessions.length - 1]?.date,
      sessions: sessions.length,
    },
    catalysts: params.catalysts,
    params: {
      gapThresholdPct: params.gapThreshold * 100,
      costPerSidePct: params.costPerSide * 100,
      slippagePerSideBps: params.slippageBps,
      slippageSource: params.slippageSource,
      startEquity: params.startEquity,
    },
    variants: {
      alwaysFade: baseline.metrics,
      alwaysFollow: alwaysFollow.metrics,
      gateDriven: gateDriven?.metrics ?? null,
      aaplNewsAware: aaplAware.metrics,
      allCatalystAware: allAware.metrics,
    },
    gateVerdictCache: params.gateCache
      ? {
          path: params.gateVerdictPath,
          model: params.gateCache.model,
          promptSource: params.gateCache.promptSource,
          generatedAt: params.gateCache.generatedAt,
          standAsideDates: gateStandAsideDatesSorted,
          followDates: gateFollowDatesSorted,
        }
      : {
          path: params.gateVerdictPath,
          status:
            "missing; run BITGET_QWEN_API_KEY=<key> npm run gate:audit to generate cached gate verdicts",
        },
    skippedOnCatalyst: {
      aapl: skipped(skippedAapl),
      all: skipped(skippedAll),
      gate: skipped(skippedGate),
    },
    honesty: gateDriven
      ? `n=${baseline.metrics.totalTrades} trades over ~6 weeks; gate-driven results come from cached Qwen verdicts, not hand-labeled catalyst dates. Still illustrative only, not statistically significant.`
      : `n=${baseline.metrics.totalTrades} trades over ~6 weeks; catalyst variants are label-grounded baselines only. Gate-driven results require a cached Qwen verdict file generated by gate:audit.`,
  };
}
