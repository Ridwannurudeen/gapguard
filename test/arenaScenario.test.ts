import { describe, expect, it } from "vitest";
import { buildArenaDemo } from "../src/arena-demo";
import { buildArenaScenario } from "../src/arenaScenario";

describe("arena behavioral scenario", () => {
  it("licenses Quorum and rejects Naive from recorded mandate behavior", async () => {
    const artifact = await buildArenaDemo();
    const quorum = artifact.passports.find(
      (passport) => passport.agentId === "quorum-rwa-desk",
    );
    const naive = artifact.passports.find(
      (passport) => passport.agentId === "naive-momentum",
    );

    expect(artifact.evidence.backtest.alphaStatus).toBe("positive");
    if (artifact.evidence.rwaFreshness.status === "fresh") {
      expect(quorum?.grade).toBe("LICENSED");
      expect(quorum?.findings.join(" | ")).toContain(
        "approval-gated for one capped supervised path",
      );
    } else {
      expect(quorum?.grade).toBe("PAPER_ONLY");
      expect(quorum?.findings).toContain("no live read-only Bitget evidence");
    }
    expect(naive?.grade).toBe("REJECTED");
    expect(naive?.findings.join(" | ")).toContain("overnight loss <= 1.5%");
    expect(artifact.naiveDecision.breachedRules).toContain(
      "stay flat when evidence conflicts",
    );
    expect(artifact.arenaChain.verification.ok).toBe(true);
    expect(artifact.arena.graduationStatus).toBe(
      "abstained_no_actionable_signal",
    );
    expect(artifact.graduationDryRun).toBeNull();
    expect(artifact.perception.source).toContain("Bitget public RWA");
    const quorumRecord = artifact.arenaChain.records.find(
      (record) => record.kind === "quorum_decision",
    );
    expect(quorumRecord?.payload).toMatchObject({
      perception: expect.objectContaining({
        symbol: "NVDAUSDT",
        isRwa: "YES",
      }),
    });
    expect(artifact.arenaChain.records.map((record) => record.kind)).toContain(
      "mandate_breach",
    );
  });

  it("keeps Quorum flat when the dislocation is fair and confidence is zero", () => {
    const scenario = buildArenaScenario("NVDAUSDT", 209.62, 20);

    expect(scenario.perception.dislocation).toMatchObject({
      direction: "fair",
      confidence: 0,
    });
    expect(scenario.quorumDecision.winningVote).toBe("flat");
    expect(scenario.quorumDecision.positionMultiplier).toBe(0);
    expect(scenario.quorumAgentDecision.mandateOk).toBe(true);
    expect(scenario.naiveAgentDecision.mandateOk).toBe(false);
    expect(scenario.naiveAgentDecision.positionPct).toBe(0.5);
    expect(scenario.quorumAgentDecision.positionPct).toBe(0);
    expect(scenario.evidence.backtest.alphaStatus).toBe("positive");
  });
});
