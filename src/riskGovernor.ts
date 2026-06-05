import type { MarketSession } from "./types";

export interface RiskInput {
  /** Dislocation direction from the estimator. */
  direction: "rich" | "cheap" | "fair";
  /** Dislocation confidence, 0–1. */
  confidence: number;
  /** Recent volatility (decimal). */
  volatility: number;
  /** Current market session. */
  session: MarketSession;
  /** Whether the underlying market is open (price discovery live). */
  underlyingOpen: boolean;
  /** Account equity in quote currency. */
  equity: number;
  /** Signed notional currently held (+ long token, − short token). */
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
};

function decideAction(current: number, target: number): RiskDecision["action"] {
  if (target === 0) return current === 0 ? "hold" : "flatten";
  if (current === 0) return target > 0 ? "enter_long" : "enter_short";
  if (Math.sign(target) !== Math.sign(current))
    return target > 0 ? "enter_long" : "enter_short";
  return Math.abs(target) < Math.abs(current) ? "reduce" : "hold";
}

const pct = (x: number): string => `${(x * 100).toFixed(1)}%`;

/**
 * The risk governor — GapGuard's differentiator. Convergence edge exists only while the
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
      reason: `Drawdown ${pct(inp.drawdownPct)} ≥ halt ${pct(cfg.drawdownHaltPct)} — circuit breaker`,
    };
  }

  if (inp.underlyingOpen && cfg.forceFlatBeforeOpen) {
    if (inp.currentExposure !== 0) {
      return {
        action: "flatten",
        targetNotional: 0,
        reason: "Underlying open — convergence realized, flattening",
      };
    }
    return {
      action: "hold",
      targetNotional: 0,
      reason: "Underlying open — no off-hours edge, standing aside",
    };
  }

  if (inp.direction === "fair") {
    if (inp.currentExposure !== 0) {
      return {
        action: "flatten",
        targetNotional: 0,
        reason: "Dislocation closed — flattening",
      };
    }
    return {
      action: "hold",
      targetNotional: 0,
      reason: "No dislocation — hold",
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
  const target = (inp.direction === "rich" ? -1 : 1) * size;
  const window = inp.underlyingOpen ? "regular" : "off-hours";
  const side = inp.direction === "rich" ? "Short" : "Long";

  return {
    action: decideAction(inp.currentExposure, target),
    targetNotional: target,
    reason: `${side} convergence — conf ${pct(inp.confidence)}, size ${size.toFixed(2)} (cap ${cap.toFixed(2)}, ${window})`,
  };
}
