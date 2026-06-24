export interface SourcedNavReference {
  /** NAV/oracle price observed before or at the decision timestamp. */
  price: number;
  /** Human-readable source, e.g. RedStone Live, Pyth, or Chainlink. */
  source: string;
  /** ISO timestamp for the reference observation. */
  asOf: string;
  /** Maximum accepted age at the decision timestamp. */
  maxAgeMs: number;
  /** True when this is a labeled fallback rather than a live NAV/oracle read. */
  fallback?: boolean;
}

export interface NavReferenceStatus {
  price: number;
  source: string;
  asOf: string | null;
  decisionTimestamp: string | null;
  ageMs: number | null;
  maxAgeMs: number | null;
  stale: boolean;
  fallback: boolean;
  label: string;
}

export interface DislocationInput {
  /** Current tokenized-stock product price. */
  tokenPrice: number;
  /** Reference fair value anchor. Used only when no sourced NAV/oracle is supplied. */
  referencePrice: number;
  /** Decision timestamp used to enforce point-in-time NAV/oracle freshness. */
  decisionTimestamp?: string;
  /** Explicit point-in-time NAV/oracle reference for the underlying fair value. */
  navReference?: SourcedNavReference;
  /** Optional off-hours proxy return (decimal) from futures/sector ETFs, applied to the anchor. */
  proxyReturn?: number;
  /** Recent return volatility (decimal, e.g. 0.02 = 2%) used to scale the dislocation. */
  volatility: number;
}

export interface DislocationResult {
  /** Reference anchor adjusted by the proxy return. */
  fairValue: number;
  /** Signed gap of the token vs fair value, as a fraction of fair value. */
  dislocationPct: number;
  /** Signed premium/discount to NAV/oracle in basis points. */
  premiumDiscountBps?: number;
  /** Dislocation in volatility units. */
  zScore: number;
  /** `rich` = token above fair value (expect snap down); `cheap` = below; `fair` = within deadband. */
  direction: "rich" | "cheap" | "fair";
  /** 0-1, ramps from the deadband edge to the saturation point. */
  confidence: number;
  /** Point-in-time NAV/oracle reference used for the fair-value anchor. */
  reference?: NavReferenceStatus;
}

// Confidence deadband (Z_LOW) and saturation (Z_HIGH) in volatility units.
const Z_LOW = 1;
const Z_HIGH = 3;

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

function parseTimestamp(value: string, label: string): number {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) {
    throw new Error(`${label} must be a valid ISO timestamp`);
  }
  return time;
}

function fallbackReference(inp: DislocationInput): NavReferenceStatus {
  return {
    price: inp.referencePrice,
    source: "fallback:referencePrice",
    asOf: null,
    decisionTimestamp: inp.decisionTimestamp ?? null,
    ageMs: null,
    maxAgeMs: null,
    stale: false,
    fallback: true,
    label: "fallback referencePrice; no sourced NAV/oracle supplied",
  };
}

function resolveReference(inp: DislocationInput): NavReferenceStatus {
  const ref = inp.navReference;
  if (!ref) return fallbackReference(inp);
  if (!inp.decisionTimestamp) {
    throw new Error("decisionTimestamp is required with navReference");
  }
  if (!Number.isFinite(ref.price) || ref.price <= 0) {
    throw new Error("navReference.price must be a positive finite number");
  }
  if (ref.source.trim().length === 0) {
    throw new Error("navReference.source must be non-empty");
  }
  if (!Number.isFinite(ref.maxAgeMs) || ref.maxAgeMs <= 0) {
    throw new Error("navReference.maxAgeMs must be a positive finite number");
  }

  const asOfMs = parseTimestamp(ref.asOf, "navReference.asOf");
  const decisionMs = parseTimestamp(inp.decisionTimestamp, "decisionTimestamp");
  if (asOfMs > decisionMs) {
    throw new Error(
      `navReference.asOf ${ref.asOf} is after decision ${inp.decisionTimestamp}`,
    );
  }

  const ageMs = decisionMs - asOfMs;
  const fallback = ref.fallback === true;
  return {
    price: ref.price,
    source: ref.source,
    asOf: ref.asOf,
    decisionTimestamp: inp.decisionTimestamp,
    ageMs,
    maxAgeMs: ref.maxAgeMs,
    stale: ageMs > ref.maxAgeMs,
    fallback,
    label: fallback
      ? `fallback ${ref.source} NAV/oracle reference`
      : `${ref.source} NAV/oracle reference`,
  };
}

/**
 * Estimate how far a tokenized stock has drifted from fair value during off-hours.
 * Below Z_LOW sigma the gap is noise (`fair`, zero confidence); above it the token is
 * `rich`/`cheap` and confidence ramps to 1 at Z_HIGH sigma.
 */
export function estimateDislocation(inp: DislocationInput): DislocationResult {
  const reference = resolveReference(inp);
  const fairValue = reference.price * (1 + (inp.proxyReturn ?? 0));
  const dislocationPct =
    fairValue !== 0 ? (inp.tokenPrice - fairValue) / fairValue : 0;
  const premiumDiscountBps = dislocationPct * 10_000;
  const vol = Math.max(inp.volatility, 1e-6);
  const zScore = dislocationPct / vol;
  const az = Math.abs(zScore);

  const direction = az < Z_LOW ? "fair" : dislocationPct > 0 ? "rich" : "cheap";
  const confidence = clamp01((az - Z_LOW) / (Z_HIGH - Z_LOW));

  return {
    fairValue,
    dislocationPct,
    premiumDiscountBps,
    zScore,
    direction,
    confidence,
    reference,
  };
}
