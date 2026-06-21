export type PassportGrade = "LICENSED" | "PAPER_ONLY" | "REJECTED";

export interface AgentEvidence {
  paperTrades: number;
  liveReadOk: boolean;
  hashChainOk: boolean;
  maxDrawdownPct: number;
  ruleViolations: number;
  debateRounds: number;
  rejectedTrades: number;
  backtestSharpe?: number;
}

export interface ArenaControls {
  riskGovernor: boolean;
  adversarialReview: boolean;
  liveNotionalCapUSDT: number;
  confirmLive: boolean;
  killSwitch: boolean;
  isolatedMargin: boolean;
  maxLeverage: number;
}

export interface AgentCandidate {
  agentId: string;
  name: string;
  thesis: string;
  evidence: AgentEvidence;
  controls: ArenaControls;
}

export interface CapitalLicense {
  liveTradingAllowed: boolean;
  maxNotionalUSDT: number;
  marginMode: "isolated";
  maxLeverage: number;
}

export interface AgentPassport {
  agentId: string;
  name: string;
  thesis: string;
  grade: PassportGrade;
  score: number;
  evidence: AgentEvidence;
  controls: ArenaControls;
  license: CapitalLicense;
  findings: string[];
}

const LIVE_NOTIONAL_CEILING_USDT = 20;
const MAX_LICENSED_DRAWDOWN_PCT = 0.08;
const MAX_LICENSED_LEVERAGE = 2;

function scoreEvidence(evidence: AgentEvidence): number {
  const paperScore = Math.min(evidence.paperTrades, 10) * 4;
  const debateScore = Math.min(evidence.debateRounds, 5) * 6;
  const restraintScore = Math.min(evidence.rejectedTrades, 5) * 4;
  const backtestScore =
    typeof evidence.backtestSharpe === "number"
      ? Math.max(0, Math.min(evidence.backtestSharpe, 3)) * 5
      : 0;
  const drawdownPenalty = Math.min(evidence.maxDrawdownPct, 0.25) * 120;
  const violationPenalty = evidence.ruleViolations * 30;
  return Math.max(
    0,
    paperScore +
      debateScore +
      restraintScore +
      backtestScore +
      (evidence.liveReadOk ? 10 : 0) +
      (evidence.hashChainOk ? 15 : 0) -
      drawdownPenalty -
      violationPenalty,
  );
}

function scoreControls(controls: ArenaControls): number {
  return [
    controls.riskGovernor,
    controls.adversarialReview,
    controls.confirmLive,
    controls.killSwitch,
    controls.isolatedMargin,
    controls.liveNotionalCapUSDT > 0 &&
      controls.liveNotionalCapUSDT <= LIVE_NOTIONAL_CEILING_USDT,
    controls.maxLeverage > 0 && controls.maxLeverage <= MAX_LICENSED_LEVERAGE,
  ].filter(Boolean).length;
}

function licensedBlockers(candidate: AgentCandidate): string[] {
  const blockers: string[] = [];
  const { evidence, controls } = candidate;

  if (!evidence.hashChainOk) blockers.push("hash-chain verification failed");
  if (!evidence.liveReadOk) blockers.push("no live read-only Bitget evidence");
  if (evidence.paperTrades < 3) blockers.push("fewer than 3 paper trades");
  if (evidence.debateRounds < 2) blockers.push("insufficient debate rounds");
  if (evidence.ruleViolations > 0) blockers.push("rule violations present");
  if (evidence.maxDrawdownPct > MAX_LICENSED_DRAWDOWN_PCT) {
    blockers.push("drawdown exceeds licensed threshold");
  }
  if (!controls.riskGovernor) blockers.push("missing risk governor");
  if (!controls.adversarialReview) blockers.push("missing adversarial review");
  if (!controls.confirmLive) blockers.push("missing human live confirmation");
  if (!controls.killSwitch) blockers.push("missing flatten kill-switch");
  if (!controls.isolatedMargin) blockers.push("margin mode is not isolated");
  if (
    controls.liveNotionalCapUSDT <= 0 ||
    controls.liveNotionalCapUSDT > LIVE_NOTIONAL_CEILING_USDT
  ) {
    blockers.push("live notional cap is invalid");
  }
  if (
    controls.maxLeverage <= 0 ||
    controls.maxLeverage > MAX_LICENSED_LEVERAGE
  ) {
    blockers.push("leverage exceeds licensed threshold");
  }

  return blockers;
}

function paperOnlyBlockers(candidate: AgentCandidate): string[] {
  const blockers: string[] = [];
  const { evidence, controls } = candidate;

  if (!evidence.hashChainOk) blockers.push("hash-chain verification failed");
  if (evidence.ruleViolations > 0) blockers.push("rule violations present");
  if (!controls.riskGovernor) blockers.push("missing risk governor");
  if (!controls.confirmLive) blockers.push("missing human live confirmation");
  if (
    controls.liveNotionalCapUSDT <= 0 ||
    controls.liveNotionalCapUSDT > LIVE_NOTIONAL_CEILING_USDT
  ) {
    blockers.push("live notional cap is invalid");
  }

  return blockers;
}

export function issuePassport(candidate: AgentCandidate): AgentPassport {
  const licensedFindings = licensedBlockers(candidate);
  const paperFindings = paperOnlyBlockers(candidate);
  const grade: PassportGrade =
    licensedFindings.length === 0
      ? "LICENSED"
      : paperFindings.length === 0
        ? "PAPER_ONLY"
        : "REJECTED";
  const score = Math.round(
    scoreEvidence(candidate.evidence) + scoreControls(candidate.controls) * 8,
  );
  const maxNotionalUSDT =
    grade === "LICENSED"
      ? Math.min(candidate.controls.liveNotionalCapUSDT, LIVE_NOTIONAL_CEILING_USDT)
      : 0;

  return {
    agentId: candidate.agentId,
    name: candidate.name,
    thesis: candidate.thesis,
    grade,
    score,
    evidence: candidate.evidence,
    controls: candidate.controls,
    license: {
      liveTradingAllowed: grade === "LICENSED",
      maxNotionalUSDT,
      marginMode: "isolated",
      maxLeverage:
        grade === "LICENSED"
          ? Math.min(candidate.controls.maxLeverage, MAX_LICENSED_LEVERAGE)
          : 0,
    },
    findings: grade === "LICENSED" ? ["licensed for one capped supervised fill"] : licensedFindings,
  };
}

export function rankPassports(passports: AgentPassport[]): AgentPassport[] {
  const gradeRank: Record<PassportGrade, number> = {
    LICENSED: 3,
    PAPER_ONLY: 2,
    REJECTED: 1,
  };
  return [...passports].sort((a, b) => {
    const gradeDiff = gradeRank[b.grade] - gradeRank[a.grade];
    return gradeDiff === 0 ? b.score - a.score : gradeDiff;
  });
}
