// Live gate accuracy audit — runs the Qwen convergence gate over every backtest
// gap with its verified overnight news context, and scores whether the gate makes
// the call GapGuard is credited for: stand aside on a real catalyst (justified
// repricing) and fade the quiet sessions (noise). This is the LIVE half of the
// news-aware thesis; the deterministic backtest (newsBacktest.ts) is the offline half.
//
//   BITGET_QWEN_API_KEY=<key> npm run gate:audit
//
// Honest scope: the news context fed to the gate is the verified catalyst fact
// (data/aaplusdt-catalysts.json) or "quiet session" — live, an Agent Hub
// news-briefing would supply this. The gate's *judgment* on that context is what
// is measured here.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { qwenChat } from "./qwen";
import {
  assessConvergence,
  effectiveMultiplier,
  type GateContext,
} from "./convergenceGate";

const apiKey = process.env.BITGET_QWEN_API_KEY;
if (!apiKey) {
  console.error(
    "Set BITGET_QWEN_API_KEY in your environment (Bitget hackathon Qwen subsidy key).",
  );
  process.exit(1);
}

interface Trade {
  ts: string;
  direction: "long" | "short";
  gapPct: number;
  returnPct: number;
}
interface Catalyst {
  date: string;
  type: string;
  weight: string;
  description: string;
}

const backtest = JSON.parse(
  readFileSync(resolve("artifacts/aaplusdt-backtest.json"), "utf8"),
) as { asset: string; trades: Trade[] };
const catalystDoc = JSON.parse(
  readFileSync(resolve("data/aaplusdt-catalysts.json"), "utf8"),
) as { catalysts: Catalyst[] };
const catByDate = new Map(catalystDoc.catalysts.map((c) => [c.date, c]));

interface GateResult {
  date: string;
  type: string;
  fadeable: boolean;
  multiplier: number;
  expectedFadeable: boolean | null;
  correct: boolean | null;
  returnPct: number;
  rationale: string;
}

const results: GateResult[] = [];
for (const t of backtest.trades) {
  const cat = catByDate.get(t.ts);
  const ctx: GateContext = {
    symbol: backtest.asset,
    direction: t.direction === "short" ? "rich" : "cheap",
    dislocationPct: t.gapPct / 100,
    sessionLabel: "overnight (US stock off-hours)",
    newsSummary: cat
      ? `Verified overnight catalyst: ${cat.description}`
      : "No Apple-specific overnight news; routine session, broad market quiet.",
  };
  const verdict = await assessConvergence(ctx, (m) => qwenChat(m, { apiKey }));
  // Scored cases: a MAJOR Apple-specific catalyst is justified repricing (expect
  // NOT fadeable); a no-news session is noise (expect fadeable). Minor/macro events
  // are genuinely ambiguous, so we report but do not score them.
  const expectedFadeable: boolean | null = cat
    ? cat.type === "aapl_event" && cat.weight === "major"
      ? false
      : null
    : true;
  const correct =
    expectedFadeable === null ? null : verdict.fadeable === expectedFadeable;
  results.push({
    date: t.ts,
    type: cat ? cat.type : "noise",
    fadeable: verdict.fadeable,
    multiplier: effectiveMultiplier(verdict),
    expectedFadeable,
    correct,
    returnPct: t.returnPct,
    rationale: verdict.rationale,
  });
  const mark =
    correct === null ? "· (ambiguous, unscored)" : correct ? "✓" : "✗";
  console.log(
    `${t.ts} [${cat ? cat.type : "noise"}] fadeable=${verdict.fadeable} ×${effectiveMultiplier(verdict).toFixed(2)} ${mark}`,
  );
}

const scored = results.filter((r) => r.correct !== null);
const correctCount = scored.filter((r) => r.correct).length;
const accuracyPct = scored.length ? (correctCount / scored.length) * 100 : 0;
const wwdc = results.find((r) => r.date === "2026-06-09");

console.log(
  `\nGate classification accuracy on scorable gaps: ${correctCount}/${scored.length} = ${accuracyPct.toFixed(0)}%`,
);
if (wwdc) {
  console.log(
    `Key case 2026-06-09 (WWDC): gate ${wwdc.fadeable ? "FADED it (would take the -1.96% loss)" : "STOOD ASIDE (correct) — avoids the -1.96% loss"}`,
  );
}

const out = resolve("artifacts/aaplusdt-gate-audit.json");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(
  out,
  `${JSON.stringify(
    {
      asset: backtest.asset,
      model: "qwen (BITGET_QWEN_API_KEY)",
      accuracyPct: +accuracyPct.toFixed(1),
      correct: correctCount,
      scored: scored.length,
      note: "Live Qwen convergence-gate verdicts on each backtest gap; scored cases = major AAPL catalyst (expect not-fadeable) + no-news sessions (expect fadeable). Macro/minor events reported but unscored.",
      results,
    },
    null,
    2,
  )}\n`,
);
console.log(`saved: ${out}`);
