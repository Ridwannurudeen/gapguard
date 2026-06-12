import type { RiskDecision } from "./riskGovernor";
import { instrumentsFor, type Instrument } from "./instruments";

/** How a risk decision is actually executed on Bitget's real instrument surface. */
export interface ExecutionPlan {
  /** The tokenized-stock signal symbol (e.g. "TSLAx"). */
  signalSymbol: string;
  /** Instrument that carries the position. */
  instrument: Instrument;
  /** Order side on that instrument. `flat` = no position to carry. */
  side: "buy" | "sell" | "flat";
  /** Absolute notional to execute. */
  notional: number;
  /** True when a short is routed to the perp because the token can't be shorted. */
  hedged: boolean;
  /**
   * True when this opens a perp position while the underlying US market is closed — Bitget
   * freezes the perp mark to an EMA during closures and its docs conflict on whether a *new*
   * position can be opened then, so the caller must confirm this live before relying on it.
   */
  closureCaveat: boolean;
  rationale: string;
}

/**
 * Route a risk decision to an executable instrument. A long target rests on the spot token;
 * a short target can't (xStocks are spot-only), so it routes to a short on the matching
 * stock perpetual — the hedge that lets GapGuard act on a "rich" gap at all.
 */
export function routeExecution(
  decision: RiskDecision,
  signalSymbol: string,
  underlyingOpen: boolean,
  currentExposure: number,
): ExecutionPlan {
  const { token, perp } = instrumentsFor(signalSymbol);
  const target = decision.targetNotional;
  const base = { signalSymbol, hedged: false, closureCaveat: false };

  if (target < 0) {
    return {
      ...base,
      instrument: perp,
      side: "sell",
      notional: -target,
      hedged: true,
      closureCaveat: !underlyingOpen,
      rationale: `Token is spot-only — short the ${perp.symbol} perp to express the rich-gap fade`,
    };
  }

  if (target > 0) {
    return {
      ...base,
      instrument: token,
      side: "buy",
      notional: target,
      rationale: `Long the ${token.symbol} spot token directly`,
    };
  }

  // target === 0: close whichever leg is open.
  if (currentExposure < 0) {
    return {
      ...base,
      instrument: perp,
      side: "buy",
      notional: -currentExposure,
      hedged: true,
      rationale: `Close the ${perp.symbol} hedge`,
    };
  }
  if (currentExposure > 0) {
    return {
      ...base,
      instrument: token,
      side: "sell",
      notional: currentExposure,
      rationale: `Sell the ${token.symbol} spot position`,
    };
  }
  return {
    ...base,
    instrument: token,
    side: "flat",
    notional: 0,
    rationale: "No position to carry",
  };
}
