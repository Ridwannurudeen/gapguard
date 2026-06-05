export interface DislocationInput {
  /** Current 24/7 tokenized-stock price. */
  tokenPrice: number;
  /** Reference fair value anchor — typically the last underlying close. */
  referencePrice: number;
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
  /** Dislocation in volatility units. */
  zScore: number;
  /** `rich` = token above fair value (expect snap down); `cheap` = below; `fair` = within deadband. */
  direction: "rich" | "cheap" | "fair";
  /** 0–1, ramps from the deadband edge to the saturation point. */
  confidence: number;
}

// Confidence deadband (Z_LOW) and saturation (Z_HIGH) in volatility units.
const Z_LOW = 1;
const Z_HIGH = 3;

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

/**
 * Estimate how far a tokenized stock has drifted from fair value during off-hours.
 * Below Z_LOW sigma the gap is noise (`fair`, zero confidence); above it the token is
 * `rich`/`cheap` and confidence ramps to 1 at Z_HIGH sigma.
 */
export function estimateDislocation(inp: DislocationInput): DislocationResult {
  const fairValue = inp.referencePrice * (1 + (inp.proxyReturn ?? 0));
  const dislocationPct =
    fairValue !== 0 ? (inp.tokenPrice - fairValue) / fairValue : 0;
  const vol = Math.max(inp.volatility, 1e-6);
  const zScore = dislocationPct / vol;
  const az = Math.abs(zScore);

  const direction = az < Z_LOW ? "fair" : dislocationPct > 0 ? "rich" : "cheap";
  const confidence = clamp01((az - Z_LOW) / (Z_HIGH - Z_LOW));

  return { fairValue, dislocationPct, zScore, direction, confidence };
}
