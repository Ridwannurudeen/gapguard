/**
 * One 24/7-observable signal for where the underlying stock *would* be trading if the US
 * market were open — e.g. index futures (NQ/ES), a sector-ETF token, or a correlated asset.
 */
export interface ProxySignal {
  name: string;
  /** The signal's own return since the fair-value anchor (decimal). */
  return: number;
  /** Sensitivity of the stock to this signal (regression beta; may be negative). */
  beta: number;
  /** Reliability / availability weight in [0, 1]. */
  weight: number;
}

export interface ProxyEstimate {
  /** Blended implied return of the underlying since the anchor (decimal). */
  proxyReturn: number;
  /** 0–1: coverage (total weight) tempered by agreement across signals. */
  confidence: number;
  /** Number of signals that actually contributed. */
  contributors: number;
}

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

/**
 * Blend proxy signals into a single implied underlying return for off-hours fair value.
 * Each signal's implied stock return is `beta * return`; the estimate is the weight-average
 * of those. Confidence combines coverage (how much trustworthy weight is present) with
 * agreement (low dispersion across the implied returns) — scattered signals are discounted.
 */
export function estimateProxyReturn(signals: ProxySignal[]): ProxyEstimate {
  const active = signals.filter((s) => s.weight > 0);
  if (active.length === 0)
    return { proxyReturn: 0, confidence: 0, contributors: 0 };

  const totalWeight = active.reduce((acc, s) => acc + s.weight, 0);
  const implied = active.map((s) => s.beta * s.return);
  const proxyReturn =
    active.reduce((acc, s, i) => acc + s.weight * implied[i], 0) / totalWeight;

  // Coverage saturates at a total weight of 2 (≈ two fully-trusted signals).
  const coverage = clamp01(totalWeight / 2);

  // Agreement: 1 when implied returns are identical, decaying with weighted dispersion.
  const variance =
    active.reduce(
      (acc, s, i) => acc + s.weight * (implied[i] - proxyReturn) ** 2,
      0,
    ) / totalWeight;
  const dispersion = Math.sqrt(variance);
  const scale = Math.max(Math.abs(proxyReturn), 0.005);
  const agreement = clamp01(1 - dispersion / scale);

  return {
    proxyReturn,
    confidence: coverage * agreement,
    contributors: active.length,
  };
}
