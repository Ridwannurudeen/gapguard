import { type AgentCandidate } from "./agentArena";
import { compileMandate, type MandateCheck, type MandateState } from "./mandate";
import { decideQuorum, type DeskOpinion, type QuorumDecision } from "./quorum";
import { estimateDislocation, type DislocationResult } from "./dislocation";
import type { RwaMarketReport, RwaMarketRow } from "./rwa-market";
import {
  assessRwaMarketFreshness,
  countPaperEvidenceRows,
  loadBestAlphaEvidence,
  type BacktestEvidenceSummary,
  type RwaFreshnessSummary,
} from "./evidence";

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

export interface ArenaPerception {
  source: string;
  symbol: string;
  tokenPrice: number;
  referencePrice: number;
  spreadBps: number | null;
  fundingRate: number | null;
  quoteVolumeUSDT: number;
  isRwa: string;
  symbolStatus: string;
  liveReady: boolean;
  blockers: string[];
  newsSummary: string;
  dislocation: DislocationResult;
}

export interface ArenaScenario {
  symbol: string;
  referencePrice: number;
  pricePath: number[];
  perception: ArenaPerception;
  mandate: {
    source: string;
    riskConfig: ReturnType<typeof compileMandate>["riskConfig"];
    rules: ReturnType<typeof compileMandate>["rules"];
  };
  evidence: {
    paperTrades: number;
    backtest: BacktestEvidenceSummary;
    rwaFreshness: RwaFreshnessSummary;
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

export interface ArenaEvidenceInputs {
  paperTrades?: number;
  backtest?: BacktestEvidenceSummary;
  rwaFreshness?: RwaFreshnessSummary;
}

function referenceFromRow(row: RwaMarketRow, fallback: number): number {
  return row.indexPrice ?? row.markPrice ?? row.lastPrice ?? fallback;
}

function tokenFromRow(row: RwaMarketRow, fallback: number): number {
  return row.lastPrice ?? row.markPrice ?? row.indexPrice ?? fallback;
}

function defaultPerception(
  symbol: string,
  referencePrice: number,
): ArenaPerception {
  const tokenPrice = referencePrice;
  return {
    source: "deterministic fallback scenario",
    symbol,
    tokenPrice,
    referencePrice,
    spreadBps: 1.5,
    fundingRate: 0,
    quoteVolumeUSDT: 0,
    isRwa: "YES",
    symbolStatus: "missing",
    liveReady: false,
    blockers: ["public/rwa-market.json unavailable"],
    newsSummary:
      "fallback RWA narrative scenario used when public/rwa-market.json is unavailable",
    dislocation: estimateDislocation({
      tokenPrice,
      referencePrice,
      volatility: 0.015,
    }),
  };
}

export function buildArenaPerceptionFromRwaMarket(
  report: RwaMarketReport,
  symbol = report.selectedLiveSymbol ?? report.defaultLiveSymbol,
  fallbackReferencePrice = 209.62,
): ArenaPerception | null {
  const row =
    report.rows.find((candidate) => candidate.symbol === symbol) ??
    report.rows.find((candidate) => candidate.symbol === report.selectedLiveSymbol) ??
    report.rows[0];
  if (!row) return null;

  const referencePrice = referenceFromRow(row, fallbackReferencePrice);
  const tokenPrice = tokenFromRow(row, referencePrice);
  return {
    source: `Bitget public RWA market report ${report.generatedAt}`,
    symbol: row.symbol,
    tokenPrice,
    referencePrice,
    spreadBps: row.spreadBps,
    fundingRate: row.fundingRate,
    quoteVolumeUSDT: row.quoteVolumeUSDT,
    isRwa: row.isRwa,
    symbolStatus: row.symbolStatus,
    liveReady: row.liveReady,
    blockers: row.blockers,
    newsSummary: `${row.symbol} isRwa=${row.isRwa}, status=${row.symbolStatus}, quoteVolumeUSDT=${row.quoteVolumeUSDT.toFixed(2)}, spreadBps=${row.spreadBps?.toFixed(3) ?? "n/a"}, fundingRate=${row.fundingRate ?? "n/a"}`,
    dislocation: estimateDislocation({
      tokenPrice,
      referencePrice,
      volatility: 0.015,
    }),
  };
}

export function buildArenaScenarioFromRwaMarket(
  report: RwaMarketReport,
  symbol = report.selectedLiveSymbol ?? report.defaultLiveSymbol,
  fallbackReferencePrice = 209.62,
  liveCap = 20,
  evidenceInputs: ArenaEvidenceInputs = {},
): ArenaScenario {
  const perception =
    buildArenaPerceptionFromRwaMarket(report, symbol, fallbackReferencePrice) ??
    defaultPerception(symbol, fallbackReferencePrice);
  return buildArenaScenario(
    perception.symbol,
    perception.referencePrice,
    liveCap,
    perception,
    evidenceInputs,
  );
}

function buildQuorumOpinions(perception: ArenaPerception): DeskOpinion[] {
  const targetVote = perception.dislocation.direction === "rich" ? "short" : "long";
  const spreadText = perception.spreadBps?.toFixed(3) ?? "n/a";
  const fundingText =
    perception.fundingRate === null ? "n/a" : perception.fundingRate.toString();

  return [
    {
      role: "narrative",
      vote: targetVote,
      confidence: 0.9,
      rationale:
        "RWA stock-perp attention is evaluated against the live ticker row before any trade is sized.",
      evidence: [`news-briefing: ${perception.newsSummary}`],
    },
    {
      role: "positioning",
      vote: targetVote,
      confidence: 0.8,
      rationale:
        "Positioning supports a trade only after funding and spread are checked against the mandate.",
      evidence: [
        `sentiment-analyst: fundingRate=${fundingText}, spreadBps=${spreadText}`,
      ],
    },
    {
      role: "market_intel",
      vote: targetVote,
      confidence: 0.7,
      rationale:
        "Public RWA contract data is normal and usable inside the supervised live cap.",
      evidence: [
        `Bitget contracts/tickers: ${perception.symbol} isRwa=${perception.isRwa}, status=${perception.symbolStatus}, liveReady=${perception.liveReady}`,
      ],
    },
    {
      role: "bear",
      vote: "flat",
      confidence: 0.45,
      rationale:
        "The dislocation read is not enough to justify a full-size chase, so the desk keeps dissent active.",
      evidence: [
        `dislocation: direction=${perception.dislocation.direction}, z=${perception.dislocation.zScore.toFixed(3)}, spreadBps=${spreadText}`,
      ],
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
}

export function buildArenaScenario(
  symbol = "NVDAUSDT",
  referencePrice = 209.62,
  liveCap = 20,
  perception = defaultPerception(symbol, referencePrice),
  evidenceInputs: ArenaEvidenceInputs = {},
): ArenaScenario {
  const mandate = compileMandate(ARENA_MANDATE_TEXT);
  const backtestEvidence =
    evidenceInputs.backtest ?? loadBestAlphaEvidence();
  const paperTrades =
    evidenceInputs.paperTrades ?? countPaperEvidenceRows();
  const rwaFreshness =
    evidenceInputs.rwaFreshness ??
    assessRwaMarketFreshness(
      process.env.ARENA_RWA_MARKET_PATH ?? "public/rwa-market.json",
    );
  const liveReadOk = perception.liveReady && rwaFreshness.status === "fresh";
  const entryPrice = perception.tokenPrice;
  const pricePath = [
    entryPrice,
    +(entryPrice * 1.021).toFixed(4),
    +(entryPrice * 0.975).toFixed(4),
  ];
  const quorumOpinions = buildQuorumOpinions(perception);
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
    referencePrice: perception.referencePrice,
    pricePath,
    perception,
    mandate: {
      source: mandate.source,
      riskConfig: mandate.riskConfig,
      rules: mandate.rules,
    },
    evidence: {
      paperTrades,
      backtest: backtestEvidence,
      rwaFreshness,
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
        paperTrades,
        liveReadOk,
        hashChainOk: true,
        maxDrawdownPct: quorumState.drawdownPct,
        ruleViolations: quorumMandateCheck.breachedRules.length,
        debateRounds: 3,
        rejectedTrades: 2,
        backtestSharpe: backtestEvidence.sharpeAnnualized,
        backtest: backtestEvidence,
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
        liveReadOk,
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
