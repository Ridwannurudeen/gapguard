import { writeFileSync } from "node:fs";
import { GlassBox, formatRecord } from "./glassbox";
import { decide, type MarketTick } from "./pipeline";

// Synthetic scenario: TSLAx tokenized stock over a weekend. Friday close = 100 (the fair-value
// anchor). The token drifts rich across the closed market on crypto sentiment, GapGuard shorts
// the convergence under the off-hours cap, then flattens at the Monday reopen as price snaps back.
const ANCHOR = 100; // Friday underlying close
const VOL = 0.015;
const scenario: MarketTick[] = [
  {
    ts: "2026-06-05T20:30:00Z",
    symbol: "TSLAx",
    tokenPrice: 100.5,
    referencePrice: ANCHOR,
    volatility: VOL,
  }, // Fri 16:30 ET, post
  {
    ts: "2026-06-06T18:00:00Z",
    symbol: "TSLAx",
    tokenPrice: 102.0,
    referencePrice: ANCHOR,
    volatility: VOL,
  }, // Sat, weekend
  {
    ts: "2026-06-07T18:00:00Z",
    symbol: "TSLAx",
    tokenPrice: 103.5,
    referencePrice: ANCHOR,
    volatility: VOL,
  }, // Sun, weekend
  {
    ts: "2026-06-08T12:00:00Z",
    symbol: "TSLAx",
    tokenPrice: 103.0,
    referencePrice: ANCHOR,
    volatility: VOL,
  }, // Mon 08:00 ET, pre
  {
    ts: "2026-06-08T13:35:00Z",
    symbol: "TSLAx",
    tokenPrice: 100.4,
    referencePrice: ANCHOR,
    volatility: VOL,
  }, // Mon 09:35 ET, regular — snap
];

// Round-trip cost charged on every rebalance: 5 bps taker fee (playbook/backtest.yaml) + 5 bps
// spread/slippage on tokenized off-hours liquidity = 10 bps on the traded notional |Δexposure|.
const COST_RATE = 0.001;

const gb = new GlassBox();
let equity = 10_000;
let exposure = 0; // signed notional carried between ticks
let peak = equity;
let prevPrice: number | null = null;
let totalCosts = 0;

const row = (...c: string[]): string =>
  c.map((s, i) => s.padEnd([18, 9, 8, 12, 13, 11, 9, 10][i])).join("");
console.log(
  row(
    "Time (ET)",
    "Session",
    "Price",
    "Dislocation",
    "Action",
    "Target",
    "Cost",
    "Equity",
  ),
);
console.log("-".repeat(89));

for (const tick of scenario) {
  if (prevPrice !== null)
    equity += exposure * ((tick.tokenPrice - prevPrice) / prevPrice); // mark held position
  peak = Math.max(peak, equity);
  const drawdownPct = (peak - equity) / peak;

  const rec = decide(tick, { equity, exposure, drawdownPct }, gb);

  const target = rec.risk.targetNotional;
  const cost = Math.abs(target - exposure) * COST_RATE; // fee + slippage on the rebalance
  equity -= cost;
  totalCosts += cost;
  exposure = target; // rebalance to target
  prevPrice = tick.tokenPrice;

  const disloc = `${rec.dislocation.direction} ${(rec.dislocation.confidence * 100).toFixed(0)}%`;
  console.log(
    row(
      rec.session.etTime.replace(" ET", ""),
      rec.session.session,
      tick.tokenPrice.toFixed(2),
      disloc,
      rec.risk.action,
      target.toFixed(0),
      cost.toFixed(2),
      equity.toFixed(2),
    ),
  );
}

const ret = ((equity - 10_000) / 10_000) * 100;
console.log("-".repeat(89));
console.log(
  `Final equity: ${equity.toFixed(2)}  |  Return: ${ret >= 0 ? "+" : ""}${ret.toFixed(2)}%  |  Costs paid: ${totalCosts.toFixed(2)}  |  Decisions logged: ${gb.all().length}`,
);

writeFileSync(
  "glassbox-demo.jsonl",
  gb.all().map(formatRecord).join("\n") + "\n",
);
console.log("Glass-box audit trail → glassbox-demo.jsonl");
