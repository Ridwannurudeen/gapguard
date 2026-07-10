import { describe, expect, it } from "vitest";
import {
  issuePassport,
  rankPassports,
  type AgentCandidate,
} from "../src/agentArena";

const quorum: AgentCandidate = {
  agentId: "quorum",
  name: "Quorum",
  thesis: "adversarial RWA trading desk",
  evidence: {
    paperTrades: 5,
    liveReadOk: true,
    hashChainOk: true,
    maxDrawdownPct: 0.02,
    ruleViolations: 0,
    debateRounds: 3,
    rejectedTrades: 2,
    backtestSharpe: 1.2,
    backtest: {
      source: "artifacts/example-positive.json",
      variant: "gateDriven",
      returnPct: 1.2,
      sharpeAnnualized: 1.2,
      totalTrades: 25,
      alphaStatus: "positive",
      note: "positive fixture for license test",
    },
  },
  controls: {
    riskGovernor: true,
    adversarialReview: true,
    liveNotionalCapUSDT: 20,
    confirmLive: true,
    killSwitch: true,
    isolatedMargin: true,
    maxLeverage: 1,
  },
};

describe("agent arena passports", () => {
  it("licenses an agent only after evidence and controls pass", () => {
    const passport = issuePassport(quorum);
    expect(passport.grade).toBe("LICENSED");
    expect(passport.license.liveTradingAllowed).toBe(true);
    expect(passport.license.maxNotionalUSDT).toBe(20);
    expect(passport.findings).toEqual([
      "default-off capped execution path; autonomous live mode requires VPS-side arming and reconciled risk gates",
    ]);
  });

  it("keeps a verified but incomplete agent paper-only", () => {
    const passport = issuePassport({
      ...quorum,
      evidence: {
        ...quorum.evidence,
        paperTrades: 1,
        liveReadOk: false,
        debateRounds: 1,
      },
    });
    expect(passport.grade).toBe("PAPER_ONLY");
    expect(passport.license.liveTradingAllowed).toBe(false);
    expect(passport.findings).toContain("no live read-only Bitget evidence");
  });

  it("keeps a controlled agent paper-only when alpha is not live-certified", () => {
    const passport = issuePassport({
      ...quorum,
      evidence: {
        ...quorum.evidence,
        backtestSharpe: -1.45,
        backtest: {
          source: "artifacts/aaplusdt-news-aware-backtest.json",
          variant: "gateDriven",
          returnPct: -2.165,
          sharpeAnnualized: -1.45,
          totalTrades: 13,
          alphaStatus: "negative",
          note: "gate-driven AI path is negative",
        },
      },
    });

    expect(passport.grade).toBe("PAPER_ONLY");
    expect(passport.license.liveTradingAllowed).toBe(false);
    expect(passport.findings.join(" | ")).toContain(
      "pilot evidence not positive",
    );
  });

  it("rejects a narrative bot with no risk governor or hash chain", () => {
    const passport = issuePassport({
      ...quorum,
      agentId: "naive",
      evidence: {
        paperTrades: 1,
        liveReadOk: true,
        hashChainOk: false,
        maxDrawdownPct: 0.12,
        ruleViolations: 1,
        debateRounds: 0,
        rejectedTrades: 0,
      },
      controls: {
        riskGovernor: false,
        adversarialReview: false,
        liveNotionalCapUSDT: 100,
        confirmLive: false,
        killSwitch: false,
        isolatedMargin: false,
        maxLeverage: 5,
      },
    });
    expect(passport.grade).toBe("REJECTED");
    expect(passport.findings).toContain("hash-chain verification failed");
    expect(passport.findings).toContain("missing risk governor");
  });

  it("ranks licensed agents above paper-only and rejected agents", () => {
    const licensed = issuePassport(quorum);
    const paperOnly = issuePassport({
      ...quorum,
      evidence: { ...quorum.evidence, liveReadOk: false },
    });
    const rejected = issuePassport({
      ...quorum,
      evidence: { ...quorum.evidence, hashChainOk: false },
    });

    expect(
      rankPassports([rejected, paperOnly, licensed]).map((p) => p.grade),
    ).toEqual(["LICENSED", "PAPER_ONLY", "REJECTED"]);
  });
});
