export type MarketSession =
  | "regular" // 9:30–16:00 ET on a trading day — underlying price discovery is live
  | "pre" // 4:00–9:30 ET
  | "post" // close–20:00 ET
  | "overnight" // 20:00–4:00 ET on trading-adjacent days
  | "weekend"
  | "holiday"; // full NYSE closure

export interface SessionState {
  session: MarketSession;
  /** True only during the regular session, when the underlying US market sets price. */
  underlyingOpen: boolean;
  /** ET wall-clock stamp for the audit log, e.g. "2026-06-05 10:00 ET". */
  etTime: string;
  /** Next regular-session open as a UTC ISO string — the moment price discovery resumes. */
  nextOpenUtc: string;
  /** Milliseconds from `now` until that open. */
  msToNextOpen: number;
}
