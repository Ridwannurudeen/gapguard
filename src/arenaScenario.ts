import { type AgentCandidate } from "./agentArena";
import { compileMandate, type MandateCheck, type MandateState } from "./mandate";
import { decideQuorum, type DeskOpinion, type QuorumDecision } from "./quorum";

export const ARENA_MANDATE_TEXT =
  "never lose >1.5% overnight; max 20% position; stay flat when evidence conflicts";

export interface ArenaAgentDecision {
  agentId: string;
  symbol: string;
  action: "size_down" | "chase_long";
  positionPct: number;
  overnightLossPct: number;
  drawdownPct: number;
  evidenceConflict: boolean;
  mandateOk: boolean;
  breachedRules: string[];
  rationale: string;
}

export interface ArenaScenario {
  symbol: string;
  referencePrice: number;
  pricePath: number[];
  mandate: {
    source: string;
    riskConfig: ReturnType<typeof compileMandate>["riskConfig"];
    rules: ReturnType<typeof compileMandate>["rules"];
  };
  quorumOpinions: DeskOpinion[];
  quorumDecision: QuorumDecision;
  quorumMandateCheck: MandateCheck;
  naiveMandateCheck: MandateCheck;
  quorumAgentDecision: ArenaAgentDecision;
  naiveAgentDecision: ArenaAgentDecision;
  quorumCandidate: AgentCandidate;
  naiveCandidate: AgentCandidate;
}

function overnightLossPct(pricePath: number[]): number {
  const entry = pricePath[0];
  const exit = pricePath[pricePath.length - 1];
  return Math.max(0, (entry - exit) / entry);
}

function summarizeCheck(
  check: MandateCheck,
  state: MandateState,
  agentId: string,
  symbol: string,
  action: ArenaAgentDecision["action"],
  rationale: string,
): ArenaAgentDecision {
  return {
    agentId,
    symbol,
    action,
    positionPct: state.positionPct,
    overnightLossPct: state.overnightLossPct,
    drawdownPct: state.drawdownPct,
    evidenceConflict: state.evidenceConflict,
    mandateOk: check.ok,
    breachedRules: check.vetoReasons,
    rationale,
  };
}

export function buildArenaScenario(
  symbol = "NVDAUSDT",
  referencePrice = 209.62,
  liveCap = 20,
): ArenaScenario {
  const mandate = compileMandate(ARENA_MANDATE_TEXT);
  const pricePath = [referencePrice, 214.2, 204.4];
  const quorumOpinions: DeskOpinion[] = [
    {
      role: "narrative",
      vote: "long",
      confidence: 0.9,
      rationale:
        "RWA stock-perp attention is accelerating around recognizable AI equity symbols.",
      evidence: ["news-briefing: AI equity narrative expanding"],
    },
    {
      role: "positioning",
      vote: "long",
      confidence: 0.8,
      rationale:
        "Positioning supports a trade, but only after the mandate caps the exposure.",
      evidence: ["sentiment-analyst: funding not at an extreme"],
    },
    {
      role: "market_intel",
      vote: "long",
      confidence: 0.7,
      rationale: "Public RWA ticker data shows normal status and usable spread.",
      evidence: ["Bitget contracts/tickers: selected symbol isRwa=YES"],
    },
    {
      role: "bear",
      vote: "flat",
      confidence: 0.45,
      rationale:
        "The same price path can punish a late narrative chase, so the desk should cut size.",
      evidence: ["scenario: late buyers lose more than the overnight mandate"],
    },
    {
      role: "risk",
      vote: "flat",
      confidence: 0.35,
      rationale:
        "The constitution permits only a capped, isolated-margin test position.",
      evidence: ["constitution: max 20% position, loss and conflict vetoes"],
    },
  ];
  const quorumDecision = decideQuorum(symbol, quorumOpinions);
  const lossPct = overnightLossPct(pricePath);
  const quorumState: MandateState = {
    overnightLossPct: lossPct * quorumDecision.positionMultiplier,
    positionPct: 0.2 * quorumDecision.positionMultiplier,
    drawdownPct: 0.021,
    evidenceConflict: false,
  };
  const naiveState: MandateState = {
    overnightLossPct: lossPct,
    positionPct: 0.5,
    drawdownPct: 0.14,
    evidenceConflict: true,
  };
  const quorumMandateCheck = mandate.check(quorumState);
  const naiveMandateCheck = mandate.check(naiveState);
  const quorumAgentDecision = summarizeCheck(
    quorumMandateCheck,
    quorumState,
    "quorum-rwa-desk",
    symbol,
    "size_down",
    "Five-role desk keeps the trade below the constitution caps after dissent.",
  );
  const naiveAgentDecision = summarizeCheck(
    naiveMandateCheck,
    naiveState,
    "naive-momentum",
    symbol,
    "chase_long",
    "Single-signal momentum bot chases the narrative without dissent or veto.",
  );

  return {
    symbol,
    referencePrice,
    pricePath,
    mandate: {
      source: mandate.source,
      riskConfig: mandate.riskConfig,
      rules: mandate.rules,
    },
    quorumOpinions,
    quorumDecision,
    quorumMandateCheck,
    naiveMandateCheck,
    quorumAgentDecision,
    naiveAgentDecision,
    quorumCandidate: {
      agentId: quorumAgentDecision.agentId,
      name: "Quorum",
      thesis:
        "Adversarial desk that trades RWA narrative-vs-positioning divergence only after earned consensus.",
      evidence: {
        paperTrades: 5,
        liveReadOk: true,
        hashChainOk: true,
        maxDrawdownPct: quorumState.drawdownPct,
        ruleViolations: quorumMandateCheck.breachedRules.length,
        debateRounds: 3,
        rejectedTrades: 2,
        backtestSharpe: 1.4,
        mandateBreaches: quorumMandateCheck.vetoReasons,
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
    },
    naiveCandidate: {
      agentId: naiveAgentDecision.agentId,
      name: "Naive Momentum",
      thesis: "Single-signal long chaser with no dissent layer.",
      evidence: {
        paperTrades: 1,
        liveReadOk: true,
        hashChainOk: true,
        maxDrawdownPct: naiveState.drawdownPct,
        ruleViolations: naiveMandateCheck.breachedRules.length,
        debateRounds: 0,
        rejectedTrades: 0,
        mandateBreaches: naiveMandateCheck.vetoReasons,
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
    },
  };
}
