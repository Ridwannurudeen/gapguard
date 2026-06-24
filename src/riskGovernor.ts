import type { NavReferenceStatus } from "./dislocation";
import type { OffHoursLiquiditySignal } from "./proxyReturn";
import type { MarketSession } from "./types";

export interface RiskInput {
  /** Dislocation direction from the estimator. */
  direction: "rich" | "cheap" | "fair";
  /** Dislocation confidence, 0-1. */
  confidence: number;
  /** Recent volatility (decimal). */
  volatility: number;
  /** Current market session. */
  session: MarketSession;
  /** Point-in-time NAV/oracle reference used to compute the dislocation. */
  reference?: NavReferenceStatus;
  /** Point-in-time off-hours order-book/volume depth context. */
  liquidity?: OffHoursLiquiditySignal;
  /** Whether the underlying market is open (price discovery live). */
  underlyingOpen: boolean;
  /** Account equity in quote currency. */
  equity: number;
  /** Signed notional currently held (+ long token, - short token). */
  currentExposure: number;
  /** Current peak-to-trough drawdown (decimal, 0.05 = 5%). */
  drawdownPct: number;
}

export interface RiskConfig {
  /** Max position as a fraction of equity while the underlying is open. */
  maxExposurePct: number;
  /** Tighter cap while the underlying is closed (gap-risk territory). */
  offHoursExposureCapPct: number;
  /** Base risk budget per trade as a fraction of equity. */
  riskPerTradePct: number;
  /** Drawdown at which the agent halts and flattens. */
  drawdownHaltPct: number;
  /** Realize convergence by flattening once the underlying reopens. */
  forceFlatBeforeOpen: boolean;
  /** Ignore rebalances smaller than this fraction of equity (avoids churn on noise). */
  rebalanceBandPct: number;
}

export interface RiskDecision {
  action: "enter_long" | "enter_short" | "reduce" | "hold" | "flatten";
  /** Signed target notional after this decision. */
  targetNotional: number;
  /** Plain-English rationale for the glass-box log. */
  reason: string;
}

export const DEFAULT_RISK_CONFIG: RiskConfig = {
  maxExposurePct: 0.5,
  offHoursExposureCapPct: 0.2,
  riskPerTradePct: 0.01,
  drawdownHaltPct: 0.1,
  forceFlatBeforeOpen: true,
  rebalanceBandPct: 0.02,
};

function decideAction(
  current: number,
  target: number,
  minDelta: number,
): RiskDecision["action"] {
  if (target === 0) return current === 0 ? "hold" : "flatten";
  if (current === 0) return target > 0 ? "enter_long" : "enter_short";
  if (Math.sign(target) !== Math.sign(current)) {
    return target > 0 ? "enter_long" : "enter_short";
  }
  if (Math.abs(target - current) < minDelta) return "hold";
  return Math.abs(target) > Math.abs(current)
    ? target > 0
      ? "enter_long"
      : "enter_short"
    : "reduce";
}

const pct = (x: number): string => `${(x * 100).toFixed(1)}%`;

function duration(ms: number | null): string {
  if (ms === null) return "n/a";
  const minutes = ms / 60_000;
  return minutes < 120
    ? `${minutes.toFixed(1)}m`
    : `${(minutes / 60).toFixed(1)}h`;
}

function flatOrHold(inp: RiskInput): Pick<RiskDecision, "action" | "targetNotional"> {
  return {
    action: inp.currentExposure === 0 ? "hold" : "flatten",
    targetNotional: 0,
  };
}

/**
 * The risk governor - GapGuard's differentiator. Convergence edge exists only while the
 * underlying is closed, so it sizes by confidence/volatility under a tighter off-hours cap,
 * realizes into the reopen, and halts on a hard drawdown breaker. Directly counters the
 * documented failure mode of LLM traders ignoring risk and position sizing.
 */
export function governRisk(
  inp: RiskInput,
  cfg: RiskConfig = DEFAULT_RISK_CONFIG,
): RiskDecision {
  if (inp.drawdownPct >= cfg.drawdownHaltPct) {
    return {
      action: inp.currentExposure === 0 ? "hold" : "flatten",
      targetNotional: 0,
      reason: `Drawdown ${pct(inp.drawdownPct)} >= halt ${pct(cfg.drawdownHaltPct)} - circuit breaker`,
    };
  }

  if (inp.reference?.stale) {
    return {
      ...flatOrHold(inp),
      reason:
        `Stale NAV/oracle reference from ${inp.reference.source} ` +
        `(asOf ${inp.reference.asOf ?? "n/a"}, age ${duration(inp.reference.ageMs)} > max ${duration(inp.reference.maxAgeMs)}) - refusing trade`,
    };
  }

  if (inp.liquidity?.gateBias === "stand_aside") {
    return {
      ...flatOrHold(inp),
      reason: `Off-hours liquidity/depth indicates real repricing - ${inp.liquidity.reason}`,
    };
  }

  if (inp.underlyingOpen && cfg.forceFlatBeforeOpen) {
    if (inp.currentExposure !== 0) {
      return {
        action: "flatten",
        targetNotional: 0,
        reason: "Underlying open - convergence realized, flattening",
      };
    }
    return {
      action: "hold",
      targetNotional: 0,
      reason: "Underlying open - no off-hours edge, standing aside",
    };
  }

  if (inp.direction === "fair") {
    if (inp.currentExposure !== 0) {
      return {
        action: "flatten",
        targetNotional: 0,
        reason: "Dislocation closed - flattening",
      };
    }
    return {
      action: "hold",
      targetNotional: 0,
      reason: "No dislocation - hold",
    };
  }

  const cap =
    (inp.underlyingOpen ? cfg.maxExposurePct : cfg.offHoursExposureCapPct) *
    inp.equity;
  const vol = Math.max(inp.volatility, 0.005);
  const size = Math.min(
    (inp.equity * cfg.riskPerTradePct * inp.confidence) / vol,
    cap,
  );
  const desired = (inp.direction === "rich" ? -1 : 1) * size;
  const action = decideAction(
    inp.currentExposure,
    desired,
    cfg.rebalanceBandPct * inp.equity,
  );
  // A banded "hold" keeps the existing position rather than nudging to the desired size.
  const target = action === "hold" ? inp.currentExposure : desired;
  const window = inp.underlyingOpen ? "regular" : "off-hours";
  const side = inp.direction === "rich" ? "Short" : "Long";
  const liquidityContext = inp.liquidity
    ? `; liquidity: ${inp.liquidity.reason}`
    : "";

  return {
    action,
    targetNotional: target,
    reason: `${side} convergence - conf ${pct(inp.confidence)}, size ${size.toFixed(2)} (cap ${cap.toFixed(2)}, ${window})${liquidityContext}`,
  };
}
