import { classifySession } from "./marketClock";
import { estimateDislocation } from "./dislocation";
import {
  governRisk,
  DEFAULT_RISK_CONFIG,
  type RiskConfig,
} from "./riskGovernor";
import { GlassBox, type DecisionRecord } from "./glassbox";

/** One observation of a tokenized stock at a point in time. */
export interface MarketTick {
  /** UTC ISO timestamp. */
  ts: string;
  symbol: string;
  /** Current 24/7 token price. */
  tokenPrice: number;
  /** Fair-value anchor — the last underlying close. */
  referencePrice: number;
  /** Optional off-hours proxy return (futures/sector ETFs). */
  proxyReturn?: number;
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
): DecisionRecord {
  const session = classifySession(new Date(tick.ts));
  const dislocation = estimateDislocation({
    tokenPrice: tick.tokenPrice,
    referencePrice: tick.referencePrice,
    proxyReturn: tick.proxyReturn,
    volatility: tick.volatility,
  });
  const risk = governRisk(
    {
      direction: dislocation.direction,
      confidence: dislocation.confidence,
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
    dislocation,
    risk,
  });
}
