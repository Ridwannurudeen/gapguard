import { describe, expect, it } from "vitest";
import { decideQuorum, type DeskOpinion } from "../src/quorum";

const bullishDesk: DeskOpinion[] = [
  {
    role: "narrative",
    vote: "long",
    confidence: 0.9,
    rationale: "RWA equity narrative is accelerating.",
    evidence: ["news-briefing: AI semiconductor bid"],
  },
  {
    role: "positioning",
    vote: "long",
    confidence: 0.8,
    rationale: "Funding and long-short are not crowded.",
    evidence: ["sentiment-analyst: neutral funding"],
  },
  {
    role: "market_intel",
    vote: "long",
    confidence: 0.75,
    rationale: "ETF and whale flow do not contradict the thesis.",
    evidence: ["market-intel: no distribution spike"],
  },
  {
    role: "bear",
    vote: "flat",
    confidence: 0.35,
    rationale:
      "Liquidity is acceptable but not deep enough for full confidence.",
    evidence: ["ticker: spread below 1bp"],
  },
  {
    role: "risk",
    vote: "long",
    confidence: 0.8,
    rationale: "Order is below cap and can be flattened.",
    evidence: ["constitution: notional below 20 USDT"],
  },
];

describe("quorum", () => {
  it("sizes by earned consensus when there is dissent but no veto", () => {
    const decision = decideQuorum("NVDAUSDT", bullishDesk);
    expect(decision.winningVote).toBe("long");
    expect(decision.vetoed).toBe(false);
    expect(decision.consensusScore).toBeGreaterThan(0.85);
    expect(decision.positionMultiplier).toBe(1);
  });

  it("turns a bear or risk veto into a flat decision", () => {
    const decision = decideQuorum("NVDAUSDT", [
      ...bullishDesk.filter((opinion) => opinion.role !== "bear"),
      {
        role: "bear",
        vote: "veto",
        confidence: 1,
        rationale: "Whale distribution contradicts the long thesis.",
        evidence: ["market-intel: distribution spike"],
      },
    ]);
    expect(decision.vetoed).toBe(true);
    expect(decision.winningVote).toBe("flat");
    expect(decision.positionMultiplier).toBe(0);
  });

  it("stands down when the desk is split below consensus threshold", () => {
    const decision = decideQuorum("NVDAUSDT", [
      { ...bullishDesk[0], vote: "long", confidence: 0.6 },
      { ...bullishDesk[1], vote: "short", confidence: 0.5 },
      { ...bullishDesk[2], vote: "flat", confidence: 0.5 },
    ]);
    expect(decision.consensusScore).toBeLessThan(0.55);
    expect(decision.winningVote).toBe("flat");
    expect(decision.positionMultiplier).toBe(0);
  });

  it("lets a well-evidenced dissent outweigh weakly-grounded votes", () => {
    // Two longs with NO cited evidence vs a Bear flat backed by 3 sources.
    // Unweighted, long (1.2) would beat flat (0.7); evidence-weighting flips it.
    const decision = decideQuorum("AAPLUSDT", [
      {
        role: "narrative",
        vote: "long",
        confidence: 0.6,
        rationale: "vibes",
        evidence: [],
      },
      {
        role: "positioning",
        vote: "long",
        confidence: 0.6,
        rationale: "vibes",
        evidence: [],
      },
      {
        role: "bear",
        vote: "flat",
        confidence: 0.7,
        rationale: "Grounded disconfirming evidence on the overnight move.",
        evidence: [
          "news-briefing: real earnings catalyst",
          "market-intel: whale distribution",
          "sentiment-analyst: funding extreme",
        ],
      },
    ]);
    expect(decision.winningVote).toBe("flat");
    expect(decision.positionMultiplier).toBe(0);
  });

  it("rejects duplicate desk roles", () => {
    expect(() =>
      decideQuorum("NVDAUSDT", [
        bullishDesk[0],
        { ...bullishDesk[0], confidence: 0.4 },
        bullishDesk[1],
      ]),
    ).toThrow("duplicate desk role");
  });
});
