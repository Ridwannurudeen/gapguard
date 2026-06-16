import { classifySession } from "./marketClock";
import { estimateDislocation } from "./dislocation";
import {
  governRisk,
  DEFAULT_RISK_CONFIG,
  type RiskConfig,
} from "./riskGovernor";
import { GlassBox, type DecisionRecord, type GateApplied } from "./glassbox";
import { estimateProxyReturn, type ProxySignal } from "./proxyReturn";

/** One observation of a tokenized stock at a point in time. */
export interface MarketTick {
  /** UTC ISO timestamp. */
  ts: string;
  symbol: string;
  /** Current tokenized-stock product price. */
  tokenPrice: number;
  /** Fair-value anchor — the last underlying close. */
  referencePrice: number;
  /** Optional off-hours proxy return (futures/sector ETFs). Used when `proxySignals` is absent. */
  proxyReturn?: number;
  /** Optional off-session proxy signals; when present, their blend overrides `proxyReturn`. */
  proxySignals?: ProxySignal[];
  /** Recent return volatility (decimal). */
  volatility: number;
}

/** Account state carried into a decision. */
export interface Portfolio {
  equity: number;
  /** Signed notional held (+ long, − short). */
  exposure: number;
  drawdownPct: number;
}

/**
 * The full GapGuard loop for one tick: classify the session, estimate the dislocation,
 * run it through the risk governor, and record the whole decision to the glass-box.
 */
export function decide(
  tick: MarketTick,
  portfolio: Portfolio,
  glassbox: GlassBox,
  cfg: RiskConfig = DEFAULT_RISK_CONFIG,
  gate?: GateApplied,
): DecisionRecord {
  const session = classifySession(new Date(tick.ts));
  const proxyEstimate = tick.proxySignals
    ? estimateProxyReturn(tick.proxySignals)
    : undefined;
  const proxyReturn = proxyEstimate
    ? proxyEstimate.proxyReturn * proxyEstimate.confidence
    : tick.proxyReturn;
  const dislocation = estimateDislocation({
    tokenPrice: tick.tokenPrice,
    referencePrice: tick.referencePrice,
    proxyReturn,
    volatility: tick.volatility,
  });
  // The LLM gate scales conviction; a non-fadeable verdict (multiplier 0) vetoes the trade.
  const gatedConfidence = dislocation.confidence * (gate?.multiplier ?? 1);
  const risk = governRisk(
    {
      direction: dislocation.direction,
      confidence: gatedConfidence,
      volatility: tick.volatility,
      session: session.session,
      underlyingOpen: session.underlyingOpen,
      equity: portfolio.equity,
      currentExposure: portfolio.exposure,
      drawdownPct: portfolio.drawdownPct,
    },
    cfg,
  );
  return glassbox.record({
    ts: tick.ts,
    symbol: tick.symbol,
    session,
    market: {
      tokenPrice: tick.tokenPrice,
      referencePrice: tick.referencePrice,
      proxyReturn,
      ...(proxyEstimate
        ? {
            proxyConfidence: proxyEstimate.confidence,
            proxyContributors: proxyEstimate.contributors,
            rawProxyReturn: proxyEstimate.proxyReturn,
          }
        : {}),
    },
    dislocation,
    risk,
    ...(gate ? { gate } : {}),
  });
}
