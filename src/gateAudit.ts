// Live gate accuracy audit — runs the Qwen convergence gate over every backtest
// gap with a blinded overnight news summary, then scores every returned verdict
// against a separate holdout label file. This is the LIVE half of the
// news-aware thesis; the deterministic backtest (newsBacktest.ts) consumes the
// cached verdicts this script writes.
//
//   BITGET_QWEN_API_KEY=<key> npm run gate:audit
//
// Honest scope: the news summaries are still curated offline, not pulled live
// from Agent Hub yet. The prompt no longer receives the fade/stand-aside label,
// and all 15 backtest gaps are scored.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { qwenChat } from "./qwen";
import {
  loadGateLabels,
  loadNewsContexts,
  type GateBacktestTrade,
} from "./gateVerdicts";
import { runGateAudit } from "./gateAuditRunner";

const apiKey = process.env.BITGET_QWEN_API_KEY;
if (!apiKey) {
  console.error(
    "Set BITGET_QWEN_API_KEY in your environment (Bitget hackathon Qwen subsidy key).",
  );
  process.exit(1);
}
const model = process.env.BITGET_QWEN_MODEL ?? "qwen3.6-plus";

const backtest = JSON.parse(
  readFileSync(resolve("artifacts/aaplusdt-backtest.json"), "utf8"),
) as { asset: string; trades: GateBacktestTrade[] };
const contextsPath = resolve("data/aaplusdt-news-contexts.json");
const labelsPath = resolve("data/aaplusdt-gate-labels.json");
const contexts = loadNewsContexts(contextsPath);
const labels = loadGateLabels(labelsPath);

const report = await runGateAudit({
  asset: backtest.asset,
  trades: backtest.trades,
  contexts,
  labels,
  chat: (messages) => qwenChat(messages, { apiKey, model }),
  model,
  generatedAt: new Date().toISOString(),
  contextsSource: contextsPath,
  labelsSource: labelsPath,
});

for (const verdict of report.verdicts) {
  const mark = verdict.correct ? "ok" : "miss";
  console.log(
    `${verdict.date} fadeable=${verdict.fadeable} x${verdict.multiplier.toFixed(2)} ${mark}`,
  );
}

const wwdc = report.verdicts.find((r) => r.date === "2026-06-09");

console.log(
  `\nGate classification accuracy on all gaps: ${report.correct}/${report.scored} = ${report.accuracyPct.toFixed(0)}%`,
);
if (wwdc) {
  console.log(
    `Key case 2026-06-09 (WWDC): gate ${wwdc.fadeable ? "FADED it (would take the -1.96% loss)" : "STOOD ASIDE — avoids the -1.96% loss"}`,
  );
}

const out = resolve("artifacts/aaplusdt-gate-audit.json");
const verdictOut = resolve("data/aaplusdt-gate-verdicts.json");
mkdirSync(dirname(out), { recursive: true });
mkdirSync(dirname(verdictOut), { recursive: true });
writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
writeFileSync(verdictOut, `${JSON.stringify(report, null, 2)}\n`);
console.log(`saved: ${out}`);
console.log(`saved gate verdict cache: ${verdictOut}`);
