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

    expect(quorum?.grade).toBe("LICENSED");
    expect(naive?.grade).toBe("REJECTED");
    expect(naive?.findings.join(" | ")).toContain(
      "overnight loss <= 1.5%",
    );
    expect(artifact.naiveDecision.breachedRules).toContain(
      "stay flat when evidence conflicts",
    );
    expect(artifact.arenaChain.verification.ok).toBe(true);
    expect(artifact.arenaChain.records.map((record) => record.kind)).toContain(
      "mandate_breach",
    );
  });

  it("makes Quorum decide the same path by sizing down instead of chasing", () => {
    const scenario = buildArenaScenario("NVDAUSDT", 209.62, 20);

    expect(scenario.quorumDecision.positionMultiplier).toBe(0.5);
    expect(scenario.quorumAgentDecision.mandateOk).toBe(true);
    expect(scenario.naiveAgentDecision.mandateOk).toBe(false);
    expect(scenario.naiveAgentDecision.positionPct).toBe(0.5);
    expect(scenario.quorumAgentDecision.positionPct).toBe(0.1);
  });
});
