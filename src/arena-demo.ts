import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  type AgentPassport,
  issuePassport,
  rankPassports,
} from "./agentArena";
import {
  sealArenaRecords,
  verifyArenaRecords,
  writeArenaChain,
  type ArenaRecord,
  type ArenaRecordInput,
} from "./arena-chain";
import {
  buildArenaScenario,
  type ArenaAgentDecision,
  type ArenaScenario,
} from "./arenaScenario";
import { type BrokerResult } from "./liveStockBroker";
import { decideQuorum, type QuorumDecision } from "./quorum";
import { placeSimulatedFuturesOrder } from "./simBroker";

const liveCap = Number(process.env.LIVE_MAX_NOTIONAL_USDT ?? "20");
const referencePrice = Number(process.env.ARENA_REFERENCE_PRICE ?? "209.62");
const riskBudgetOrderSize = Number(
  process.env.ARENA_LIVE_ORDER_SIZE ?? process.env.ARENA_ORDER_SIZE ?? "0.06",
);

export interface ArenaDemoArtifact {
  generatedAt: string;
  arena: {
    thesis: string;
    liveInstrument: string;
    graduationStatus: string;
  };
  mandate: ArenaScenario["mandate"];
  quorumDecision: QuorumDecision;
  naiveDecision: ArenaAgentDecision;
  passports: AgentPassport[];
  graduationDryRun: BrokerResult;
  arenaChain: {
    path: string;
    verification: ReturnType<typeof verifyArenaRecords>;
    records: ArenaRecord[];
  };
}

function sideFromQuorum(decision: ReturnType<typeof decideQuorum>) {
  if (decision.winningVote === "short") return "open_short";
  if (decision.winningVote === "long") return "open_long";
  throw new Error("flat quorum decision has no order side");
}

export function buildArenaPassports() {
  const scenario = buildArenaScenario(
    process.env.ARENA_LIVE_SYMBOL ?? "NVDAUSDT",
    referencePrice,
    liveCap,
  );
  return rankPassports([
    issuePassport(scenario.quorumCandidate),
    issuePassport(scenario.naiveCandidate),
  ]);
}

export function buildDefaultQuorumDecision(symbol: string) {
  return decideQuorum(
    symbol,
    buildArenaScenario(symbol, referencePrice, liveCap).quorumOpinions,
  );
}

function buildArenaChainInputs(
  ts: string,
  scenario: ArenaScenario,
  passports: AgentPassport[],
  graduationDryRun: BrokerResult,
): ArenaRecordInput[] {
  return [
    ...scenario.mandate.rules.map((rule) => ({
      ts,
      kind: "mandate_rule" as const,
      agentId: "arena-constitution",
      payload: rule,
    })),
    {
      ts,
      kind: "quorum_decision",
      agentId: scenario.quorumAgentDecision.agentId,
      payload: {
        decision: scenario.quorumDecision,
        mandate: scenario.quorumAgentDecision,
      },
    },
    {
      ts,
      kind: "agent_decision",
      agentId: scenario.naiveAgentDecision.agentId,
      payload: scenario.naiveAgentDecision,
    },
    ...scenario.naiveMandateCheck.breachedRules.map((rule) => ({
      ts,
      kind: "mandate_breach" as const,
      agentId: scenario.naiveAgentDecision.agentId,
      payload: {
        rule,
        decision: scenario.naiveAgentDecision,
      },
    })),
    ...passports.map((passport) => ({
      ts,
      kind: "passport_issued" as const,
      agentId: passport.agentId,
      payload: passport,
    })),
    {
      ts,
      kind: "broker_order",
      agentId: scenario.quorumAgentDecision.agentId,
      payload: graduationDryRun,
    },
  ];
}

export async function buildArenaDemo(): Promise<ArenaDemoArtifact> {
  const ts = new Date().toISOString();
  const scenario = buildArenaScenario(
    process.env.ARENA_LIVE_SYMBOL ?? "NVDAUSDT",
    referencePrice,
    liveCap,
  );
  const passports = rankPassports([
    issuePassport(scenario.quorumCandidate),
    issuePassport(scenario.naiveCandidate),
  ]);
  const orderSize = Number(
    (riskBudgetOrderSize * scenario.quorumDecision.positionMultiplier).toFixed(
      8,
    ),
  );
  const graduationDryRun = await placeSimulatedFuturesOrder(
    {
      symbol: scenario.quorumDecision.symbol,
      side: sideFromQuorum(scenario.quorumDecision),
      size: orderSize,
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
    {
      pricePath: scenario.pricePath,
      ts,
    },
  );
  const records = sealArenaRecords(
    buildArenaChainInputs(ts, scenario, passports, graduationDryRun),
  );
  const verification = verifyArenaRecords(records);

  return {
    generatedAt: ts,
    arena: {
      thesis:
        "The Arena does not trust autonomous agents by default; it makes them earn a passport before any real capital is unlocked.",
      liveInstrument: graduationDryRun.plan.order.symbol,
      graduationStatus: "sim_dry_run_ready",
    },
    mandate: scenario.mandate,
    quorumDecision: scenario.quorumDecision,
    naiveDecision: scenario.naiveAgentDecision,
    passports,
    graduationDryRun,
    arenaChain: {
      path: "public/arena-chain.jsonl",
      verification,
      records,
    },
  };
}

export async function runArenaDemoCli(): Promise<void> {
  const out = resolve(process.argv[2] ?? "artifacts/agent-arena-demo.json");
  const chainOut = resolve(process.argv[3] ?? "public/arena-chain.jsonl");
  const artifact = await buildArenaDemo();
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(artifact, null, 2)}\n`);
  writeArenaChain(chainOut, artifact.arenaChain.records);
  console.log(`Agent Arena demo artifact: ${out}`);
  console.log(`Agent Arena chain: ${chainOut}`);
}

if (process.argv[1]?.endsWith("arena-demo.ts")) {
  await runArenaDemoCli();
}
