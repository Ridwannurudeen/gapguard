/**
 * One 24/7-observable signal for where the underlying stock would be trading if the US
 * market were open - e.g. index futures (NQ/ES), a sector-ETF token, or a correlated asset.
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
  /** 0-1: coverage (total weight) tempered by agreement across signals. */
  confidence: number;
  /** Number of signals that actually contributed. */
  contributors: number;
}

export type OffHoursLiquidityDepth = "thin" | "balanced" | "deep" | "unknown";
export type OffHoursLiquidityGateBias =
  | "fade_noise"
  | "stand_aside"
  | "neutral";

export interface OffHoursLiquidityInput {
  /** Human-readable data source for the order-book/volume observation. */
  source: string;
  /** ISO timestamp for the order-book/volume observation. */
  asOf: string;
  /** Optional decision timestamp for no-look-ahead validation. */
  decisionTimestamp?: string;
  /** Best bid; used to derive spread when spreadBps is absent. */
  bidPrice?: number | null;
  /** Best ask; used to derive spread when spreadBps is absent. */
  askPrice?: number | null;
  /** Explicit order-book spread in basis points. */
  spreadBps?: number | null;
  /** Observed off-hours quote/base volume in the same units as typicalOffHoursVolume. */
  offHoursVolume: number;
  /** Point-in-time trailing/off-hours baseline volume available at the decision timestamp. */
  typicalOffHoursVolume?: number | null;
  /** True when this is a labeled fallback rather than a live order-book read. */
  fallback?: boolean;
}

export interface OffHoursLiquiditySignal {
  source: string;
  asOf: string;
  spreadBps: number | null;
  offHoursVolume: number;
  volumeRatio: number | null;
  depth: OffHoursLiquidityDepth;
  gateBias: OffHoursLiquidityGateBias;
  fallback: boolean;
  reason: string;
}

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));
const WIDE_SPREAD_BPS = 25;
const TIGHT_SPREAD_BPS = 10;
const THIN_VOLUME_RATIO = 0.25;
const DEEP_VOLUME_RATIO = 2;

function parseTimestamp(value: string, label: string): number {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) {
    throw new Error(`${label} must be a valid ISO timestamp`);
  }
  return time;
}

function assertPointInTime(asOf: string, decisionTimestamp?: string): void {
  if (!decisionTimestamp) return;
  if (
    parseTimestamp(asOf, "asOf") >
    parseTimestamp(decisionTimestamp, "decisionTimestamp")
  ) {
    throw new Error(`liquidity asOf ${asOf} is after decision ${decisionTimestamp}`);
  }
}

function finiteNonNegative(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a non-negative finite number`);
  }
  return value;
}

function finitePositiveOrNull(
  value: number | null | undefined,
  label: string,
): number | null {
  if (value === undefined || value === null) return null;
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be a positive finite number`);
  }
  return value;
}

function resolveSpreadBps(input: OffHoursLiquidityInput): number | null {
  if (input.spreadBps !== undefined && input.spreadBps !== null) {
    return finiteNonNegative(input.spreadBps, "spreadBps");
  }
  const bid = finitePositiveOrNull(input.bidPrice, "bidPrice");
  const ask = finitePositiveOrNull(input.askPrice, "askPrice");
  if (bid === null || ask === null) return null;
  if (ask < bid) {
    throw new Error("askPrice must be greater than or equal to bidPrice");
  }
  const mid = (ask + bid) / 2;
  return mid > 0 ? ((ask - bid) / mid) * 10_000 : null;
}

function resolveVolumeRatio(input: OffHoursLiquidityInput): number | null {
  if (
    input.typicalOffHoursVolume === undefined ||
    input.typicalOffHoursVolume === null
  ) {
    return null;
  }
  const typical = finitePositiveOrNull(
    input.typicalOffHoursVolume,
    "typicalOffHoursVolume",
  );
  return typical === null ? null : input.offHoursVolume / typical;
}

function fmtNullable(value: number | null, digits: number): string {
  return value === null ? "n/a" : value.toFixed(digits);
}

/**
 * Blend proxy signals into a single implied underlying return for off-hours fair value.
 * Each signal's implied stock return is `beta * return`; the estimate is the weight-average
 * of those. Confidence combines coverage (how much trustworthy weight is present) with
 * agreement (low dispersion across the implied returns) - scattered signals are discounted.
 */
export function estimateProxyReturn(signals: ProxySignal[]): ProxyEstimate {
  const active = signals.filter((s) => s.weight > 0);
  if (active.length === 0) {
    return { proxyReturn: 0, confidence: 0, contributors: 0 };
  }

  const totalWeight = active.reduce((acc, s) => acc + s.weight, 0);
  const implied = active.map((s) => s.beta * s.return);
  const proxyReturn =
    active.reduce((acc, s, i) => acc + s.weight * implied[i], 0) / totalWeight;

  // Coverage saturates at a total weight of 2 (roughly two fully-trusted signals).
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

/**
 * Classify off-hours order-book depth from spread and point-in-time volume.
 * Thin books support the "liquidity noise -> fade" hypothesis; unusually deep,
 * tight, high-volume books are treated as real repricing context and should stand aside.
 */
export function estimateOffHoursLiquidity(
  input: OffHoursLiquidityInput,
): OffHoursLiquiditySignal {
  if (input.source.trim().length === 0) {
    throw new Error("source must be non-empty");
  }
  assertPointInTime(input.asOf, input.decisionTimestamp);

  const offHoursVolume = finiteNonNegative(
    input.offHoursVolume,
    "offHoursVolume",
  );
  const spreadBps = resolveSpreadBps(input);
  const volumeRatio = resolveVolumeRatio({ ...input, offHoursVolume });

  const wideSpread = spreadBps !== null && spreadBps >= WIDE_SPREAD_BPS;
  const lowVolume =
    volumeRatio !== null
      ? volumeRatio <= THIN_VOLUME_RATIO
      : offHoursVolume === 0;
  const tightSpread = spreadBps !== null && spreadBps <= TIGHT_SPREAD_BPS;
  const highVolume = volumeRatio !== null && volumeRatio >= DEEP_VOLUME_RATIO;

  let depth: OffHoursLiquidityDepth = "balanced";
  if (spreadBps === null && volumeRatio === null) {
    depth = "unknown";
  } else if (wideSpread || lowVolume) {
    depth = "thin";
  } else if (tightSpread && highVolume) {
    depth = "deep";
  }

  const gateBias: OffHoursLiquidityGateBias =
    depth === "thin"
      ? "fade_noise"
      : depth === "deep"
        ? "stand_aside"
        : "neutral";
  const fallback = input.fallback === true;
  const reason =
    depth === "thin"
      ? `thin off-hours liquidity: spread=${fmtNullable(spreadBps, 1)}bps, volume=${offHoursVolume.toFixed(2)}, ratio=${fmtNullable(volumeRatio, 2)}; treat as fadeable noise context`
      : depth === "deep"
        ? `deep off-hours liquidity: spread=${fmtNullable(spreadBps, 1)}bps, volume=${offHoursVolume.toFixed(2)}, ratio=${fmtNullable(volumeRatio, 2)}; stand aside from real repricing`
        : depth === "unknown"
          ? `fallback/unknown off-hours liquidity: spread=n/a, volume=${offHoursVolume.toFixed(2)}, ratio=n/a`
          : `balanced off-hours liquidity: spread=${fmtNullable(spreadBps, 1)}bps, volume=${offHoursVolume.toFixed(2)}, ratio=${fmtNullable(volumeRatio, 2)}`;

  return {
    source: input.source,
    asOf: input.asOf,
    spreadBps,
    offHoursVolume,
    volumeRatio,
    depth,
    gateBias,
    fallback,
    reason: fallback ? `fallback labeled: ${reason}` : reason,
  };
}
