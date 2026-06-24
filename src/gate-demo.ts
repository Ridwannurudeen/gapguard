import { qwenChat } from "./qwen";
import { buildOperationalCatalystBundle } from "./catalystBundle";
import {
  assessConvergence,
  effectiveMultiplier,
  type GateContext,
} from "./convergenceGate";
import { loadNewsFeed } from "./newsFeed";

const apiKey = process.env.BITGET_QWEN_API_KEY;
if (!apiKey) {
  console.error(
    "Set BITGET_QWEN_API_KEY in your environment (Bitget hackathon Qwen subsidy key).",
  );
  process.exit(1);
}

// Two off-hours gaps that look identical to the deterministic layer (both rich) but are not:
// one is weekend sentiment noise (fade it), the other is a real earnings beat (stand down).
const cases: GateContext[] = [
  {
    symbol: "TSLAx",
    direction: "rich",
    dislocationPct: 0.035,
    sessionLabel: "weekend",
    newsSummary:
      "Quiet weekend. No company-specific news; broad crypto risk-on is lifting most tokens.",
  },
  {
    symbol: "NVDAx",
    direction: "rich",
    dislocationPct: 0.06,
    sessionLabel: "overnight",
    newsSummary:
      "Company pre-announced a major earnings beat after Friday's close; multiple analysts raising price targets.",
  },
];

const liveFeed = loadNewsFeed();
const decisionTimestamp = new Date().toISOString();

for (const ctx of cases) {
  const liveContext: GateContext = liveFeed
    ? {
        ...ctx,
        catalystBundle: buildOperationalCatalystBundle({
          asset: ctx.symbol,
          newsSummary: ctx.newsSummary,
          liveFeed,
          decisionTimestamp,
        }),
      }
    : ctx;
  const verdict = await assessConvergence(liveContext, (m) =>
    qwenChat(m, { apiKey }),
  );
  console.log(
    `\n${ctx.symbol}  (${ctx.direction} ${(ctx.dislocationPct * 100).toFixed(1)}%, ${ctx.sessionLabel})`,
  );
  console.log(
    `  fadeable=${verdict.fadeable}   effective confidence ×${effectiveMultiplier(verdict).toFixed(2)}`,
  );
  console.log(`  ${verdict.rationale}`);
}
