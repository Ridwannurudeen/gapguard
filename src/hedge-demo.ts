import { GlassBox } from "./glassbox";
import { decide, type MarketTick, type Portfolio } from "./pipeline";
import { routeExecution } from "./hedgeRouter";

// Three gaps that exercise every routing branch: a rich off-hours gap (must hedge via the perp,
// since the token can't be shorted), a cheap off-hours gap (rest the long on the spot token),
// and the Monday reopen that flattens a carried hedge.
const cases: { tick: MarketTick; portfolio: Portfolio; note: string }[] = [
  {
    note: "rich token, market closed → fade the gap",
    tick: {
      ts: "2026-06-07T18:00:00Z",
      symbol: "TSLAx",
      tokenPrice: 103.5,
      referencePrice: 100,
      volatility: 0.015,
    },
    portfolio: { equity: 10_000, exposure: 0, drawdownPct: 0 },
  },
  {
    note: "cheap token, market closed → buy the discount",
    tick: {
      ts: "2026-06-07T18:00:00Z",
      symbol: "TSLAx",
      tokenPrice: 96.5,
      referencePrice: 100,
      volatility: 0.015,
    },
    portfolio: { equity: 10_000, exposure: 0, drawdownPct: 0 },
  },
  {
    note: "Monday reopen, carrying a short hedge → realize",
    tick: {
      ts: "2026-06-08T13:35:00Z",
      symbol: "TSLAx",
      tokenPrice: 100.4,
      referencePrice: 100,
      volatility: 0.015,
    },
    portfolio: { equity: 10_000, exposure: -1996, drawdownPct: 0 },
  },
];

const gb = new GlassBox();
const w = [13, 13, 10, 16, 14, 6, 9];
const row = (...c: string[]): string =>
  c.map((s, i) => s.padEnd(w[i])).join("");

console.log(
  row("Session", "Action", "Target", "Instrument", "Venue", "Side", "Caveat"),
);
console.log("-".repeat(83));

for (const { tick, portfolio } of cases) {
  const rec = decide(tick, portfolio, gb);
  const plan = routeExecution(
    rec.risk,
    tick.symbol,
    rec.session.underlyingOpen,
    portfolio.exposure,
  );
  console.log(
    row(
      rec.session.session,
      rec.risk.action,
      rec.risk.targetNotional.toFixed(0),
      `${plan.instrument.symbol} (${plan.side})`,
      plan.instrument.venue,
      plan.notional.toFixed(0),
      plan.closureCaveat ? "⚠ open" : "—",
    ),
  );
  console.log(`              ${plan.rationale}`);
}

console.log("-".repeat(83));
console.log(
  "⚠ open = opening a perp while the US market is closed; confirm Bitget allows it live before relying on it.",
);
