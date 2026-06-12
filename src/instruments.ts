/**
 * The Bitget instrument model behind a GapGuard signal (verified June 2026).
 *
 * A tokenized US stock ("xStock", e.g. TSLAx) trades only as a spot swap on Bitget Onchain /
 * Wallet — it is buy-or-flat, with **no native short**. To express a short you use the matching
 * USDT-margined **stock perpetual** (e.g. TSLAUSDT) on the CEX derivatives surface
 * (`productType=USDT-FUTURES`, flagged `isRwa=YES`), which is long/short and trades ~24/7.
 */

/** Bitget surface that can carry a position. */
export type Venue = "onchain-spot" | "usdt-futures";

export interface Instrument {
  /** Symbol as it appears on its venue. */
  symbol: string;
  venue: Venue;
  /** Can a short be opened here? xStocks are spot-only (long-or-flat). */
  canShort: boolean;
  /** Bitget Futures API productType — present for perps. */
  productType?: "USDT-FUTURES";
}

/**
 * Map a GapGuard signal symbol (the tokenized stock, e.g. "TSLAx") to the two Bitget
 * instruments that can carry exposure: the spot token and the stock perpetual.
 */
export function instrumentsFor(signalSymbol: string): {
  token: Instrument;
  perp: Instrument;
} {
  const ticker = signalSymbol.replace(/x$/i, "").toUpperCase(); // "TSLAx" → "TSLA"
  return {
    token: { symbol: `${ticker}x`, venue: "onchain-spot", canShort: false },
    perp: {
      symbol: `${ticker}USDT`,
      venue: "usdt-futures",
      canShort: true,
      productType: "USDT-FUTURES",
    },
  };
}
