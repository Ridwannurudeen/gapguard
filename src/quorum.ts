export type DeskRole =
  | "narrative"
  | "positioning"
  | "market_intel"
  | "bear"
  | "risk";
export type DeskVote = "long" | "short" | "flat" | "veto";

export interface DeskOpinion {
  role: DeskRole;
  vote: DeskVote;
  confidence: number;
  rationale: string;
  evidence: string[];
}

export interface QuorumDecision {
  symbol: string;
  winningVote: Exclude<DeskVote, "veto">;
  consensusScore: number;
  vetoed: boolean;
  positionMultiplier: number;
  rationale: string;
  opinions: DeskOpinion[];
}

function assertConfidence(value: number): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error("confidence must be a finite number from 0 to 1");
  }
}

function winningVote(opinions: DeskOpinion[]): {
  vote: Exclude<DeskVote, "veto">;
  score: number;
  total: number;
} {
  const scores: Record<Exclude<DeskVote, "veto">, number> = {
    long: 0,
    short: 0,
    flat: 0,
  };

  for (const opinion of opinions) {
    if (opinion.vote === "veto") continue;
    scores[opinion.vote] += opinion.confidence;
  }

  const entries = Object.entries(scores) as [
    Exclude<DeskVote, "veto">,
    number,
  ][];
  const [vote, score] = entries.sort((a, b) => b[1] - a[1])[0];
  const total = entries.reduce((sum, [, value]) => sum + value, 0);
  return { vote, score, total };
}

function multiplier(consensusScore: number, vetoed: boolean): number {
  if (vetoed) return 0;
  if (consensusScore < 0.55) return 0;
  if (consensusScore < 0.7) return 0.25;
  if (consensusScore < 0.85) return 0.5;
  return 1;
}

export function decideQuorum(
  symbol: string,
  opinions: DeskOpinion[],
): QuorumDecision {
  if (!symbol) throw new Error("symbol is required");
  if (opinions.length < 3) throw new Error("at least 3 desk opinions are required");

  const seen = new Set<DeskRole>();
  for (const opinion of opinions) {
    if (seen.has(opinion.role)) {
      throw new Error(`duplicate desk role: ${opinion.role}`);
    }
    seen.add(opinion.role);
    assertConfidence(opinion.confidence);
    if (!opinion.rationale) throw new Error(`${opinion.role} rationale is required`);
  }

  const vetoed = opinions.some(
    (opinion) =>
      opinion.vote === "veto" &&
      (opinion.role === "bear" || opinion.role === "risk"),
  );
  const winner = winningVote(opinions);
  const consensusScore = winner.total === 0 ? 0 : winner.score / winner.total;
  const positionMultiplier = multiplier(consensusScore, vetoed);
  const dissenters = opinions.filter(
    (opinion) => opinion.vote !== winner.vote && opinion.vote !== "veto",
  ).length;
  const vetoText = vetoed ? "hard veto present; no order allowed" : "no hard veto";
  const sizeText =
    positionMultiplier === 0
      ? "stand down"
      : `size at ${(positionMultiplier * 100).toFixed(0)}% of risk budget`;

  return {
    symbol,
    winningVote: positionMultiplier === 0 ? "flat" : winner.vote,
    consensusScore,
    vetoed,
    positionMultiplier,
    rationale: `${winner.vote} won ${(consensusScore * 100).toFixed(0)}% weighted consensus with ${dissenters} dissenters; ${vetoText}; ${sizeText}`,
    opinions: opinions.map((opinion) => ({
      ...opinion,
      evidence: [...opinion.evidence],
    })),
  };
}
