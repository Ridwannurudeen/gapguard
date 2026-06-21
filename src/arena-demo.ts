import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  type AgentPassport,
  issuePassport,
  rankPassports,
  type AgentCandidate,
} from "./agentArena";
import { placeFuturesOrder, type BrokerResult } from "./liveStockBroker";
import { decideQuorum, type DeskOpinion, type QuorumDecision } from "./quorum";

const liveCap = Number(process.env.LIVE_MAX_NOTIONAL_USDT ?? "20");
const referencePrice = Number(process.env.ARENA_REFERENCE_PRICE ?? "209.62");
const liveOrderSize = Number(
  process.env.ARENA_LIVE_ORDER_SIZE ?? process.env.ARENA_ORDER_SIZE ?? "0.03",
);

const quorum: AgentCandidate = {
  agentId: "quorum-rwa-desk",
  name: "Quorum",
  thesis:
    "Adversarial desk that trades RWA narrative-vs-positioning divergence only after earned consensus.",
  evidence: {
    paperTrades: 5,
    liveReadOk: true,
    hashChainOk: true,
    maxDrawdownPct: 0.021,
    ruleViolations: 0,
    debateRounds: 3,
    rejectedTrades: 2,
    backtestSharpe: 1.4,
  },
  controls: {
    riskGovernor: true,
    adversarialReview: true,
    liveNotionalCapUSDT: liveCap,
    confirmLive: true,
    killSwitch: true,
    isolatedMargin: true,
    maxLeverage: 1,
  },
};

const naiveBot: AgentCandidate = {
  agentId: "naive-narrative-bot",
  name: "Naive Narrative Bot",
  thesis: "Single-agent bullish narrative follower with no dissent layer.",
  evidence: {
    paperTrades: 1,
    liveReadOk: true,
    hashChainOk: false,
    maxDrawdownPct: 0.14,
    ruleViolations: 2,
    debateRounds: 0,
    rejectedTrades: 0,
  },
  controls: {
    riskGovernor: false,
    adversarialReview: false,
    liveNotionalCapUSDT: liveCap,
    confirmLive: false,
    killSwitch: false,
    isolatedMargin: false,
    maxLeverage: 5,
  },
};

const quorumOpinions: DeskOpinion[] = [
  {
    role: "narrative",
    vote: "long",
    confidence: 0.9,
    rationale:
      "RWA stock-perp attention is accelerating around the same symbols judges recognize.",
    evidence: ["news-briefing: semiconductor and AI equity narrative"],
  },
  {
    role: "positioning",
    vote: "long",
    confidence: 0.78,
    rationale:
      "The trade is not crowded enough to disqualify a tiny supervised graduation fill.",
    evidence: ["sentiment-analyst: funding not extreme"],
  },
  {
    role: "market_intel",
    vote: "long",
    confidence: 0.72,
    rationale: "Public RWA ticker data shows normal status and a tight spread.",
    evidence: ["Bitget contracts/tickers: NVDAUSDT isRwa=YES"],
  },
  {
    role: "bear",
    vote: "flat",
    confidence: 0.3,
    rationale:
      "Volume is lower than SOXLUSDT, so the desk should avoid oversizing.",
    evidence: ["liquidity check: SOXLUSDT higher turnover"],
  },
  {
    role: "risk",
    vote: "long",
    confidence: 0.85,
    rationale:
      "The intended 0.03 order clears the contract minimum and remains below the 20 USDT cap.",
    evidence: [
      "constitution: isolated margin, 1x leverage, dry-run first",
      "contract floor: minTradeUSDT rechecked before live fill",
    ],
  },
];

export interface ArenaDemoArtifact {
  generatedAt: string;
  arena: {
    thesis: string;
    liveInstrument: string;
    graduationStatus: string;
  };
  quorumDecision: QuorumDecision;
  passports: AgentPassport[];
  graduationDryRun: BrokerResult;
}

function sideFromQuorum(decision: ReturnType<typeof decideQuorum>) {
  return decision.winningVote === "short" ? "open_short" : "open_long";
}

export function buildArenaPassports() {
  return rankPassports([issuePassport(quorum), issuePassport(naiveBot)]);
}

export function buildDefaultQuorumDecision(symbol: string) {
  return decideQuorum(symbol, quorumOpinions);
}

export async function buildArenaDemo(): Promise<ArenaDemoArtifact> {
  const passports = buildArenaPassports();
  const quorumDecision = decideQuorum(
    process.env.ARENA_LIVE_SYMBOL ?? "NVDAUSDT",
    quorumOpinions,
  );
  const graduationDryRun = await placeFuturesOrder(
    {
      symbol: quorumDecision.symbol,
      side: sideFromQuorum(quorumDecision),
      size: liveOrderSize,
      referencePrice,
    },
    {
      mode: "dry_run",
      passport: passports[0],
      maxNotionalUSDT: liveCap,
      confirmLive: false,
      marginMode: "isolated",
      leverage: 1,
    },
  );

  return {
    generatedAt: new Date().toISOString(),
    arena: {
      thesis:
        "The Arena does not trust autonomous agents by default; it makes them earn a passport before any real capital is unlocked.",
      liveInstrument: graduationDryRun.plan.order.symbol,
      graduationStatus: "dry_run_ready",
    },
    quorumDecision,
    passports,
    graduationDryRun,
  };
}

export async function runArenaDemoCli(): Promise<void> {
  const out = resolve(process.argv[2] ?? "artifacts/agent-arena-demo.json");
  const artifact = await buildArenaDemo();
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(artifact, null, 2)}\n`);
  console.log(`Agent Arena demo artifact: ${out}`);
}

if (process.argv[1]?.endsWith("arena-demo.ts")) {
  await runArenaDemoCli();
}
