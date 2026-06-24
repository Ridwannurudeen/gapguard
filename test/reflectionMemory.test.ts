import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildMessages, type GateContext } from "../src/convergenceGate";
import {
  appendMemoryRecord,
  appendReflectionRecord,
  generateReflectionPayload,
  readReflectionChain,
  resolveDueDecisions,
  selectReflectionLessons,
  verifyReflectionRecords,
  type DecisionOutcome,
} from "../src/reflectionMemory";

function tempChain(): { dir: string; path: string } {
  const dir = mkdtempSync(join(tmpdir(), "gapguard-reflection-"));
  return { dir, path: join(dir, "chain.jsonl") };
}

function cleanup(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

function outcomeFor(hash: string, symbol = "AAPLUSDT"): DecisionOutcome {
  return {
    resolvedDecisionHash: hash,
    decisionTs: "2026-06-24T00:00:00.000Z",
    resolvedAt: "2026-06-24T15:30:00.000Z",
    symbol,
    direction: "long",
    entryPrice: 100,
    exitPrice: 105,
    benchmarkName: "underlying",
    benchmarkEntryPrice: 200,
    benchmarkExitPrice: 202,
    rawReturnPct: 5,
    benchmarkReturnPct: 1,
    alphaPct: 4,
    holdingWindowMs: 60_000,
    costPct: 0,
  };
}

const gateContext: GateContext = {
  symbol: "AAPLUSDT",
  direction: "rich",
  dislocationPct: 0.02,
  sessionLabel: "overnight",
  newsSummary: "Quiet off-hours tape.",
};

describe("reflectionMemory", () => {
  it("resolves only elapsed, unresolved decisions and computes raw return plus benchmark alpha", () => {
    const { dir, path } = tempChain();
    try {
      const due = appendMemoryRecord(path, {
        agentId: "quorum-rwa-desk",
        kind: "quorum_decision",
        ts: "2026-06-24T00:00:00.000Z",
        payload: {
          symbol: "AAPLUSDT",
          direction: "long",
          entryPrice: 100,
          benchmarkEntryPrice: 200,
        },
      });
      appendMemoryRecord(path, {
        agentId: "quorum-rwa-desk",
        kind: "quorum_decision",
        ts: "2026-06-24T09:59:30.000Z",
        payload: {
          symbol: "AAPLUSDT",
          direction: "short",
          entryPrice: 100,
          benchmarkEntryPrice: 200,
        },
      });
      const alreadyResolved = appendMemoryRecord(path, {
        agentId: "quorum-rwa-desk",
        kind: "agent_decision",
        ts: "2026-06-24T00:00:00.000Z",
        payload: {
          symbol: "NVDAUSDT",
          action: "chase_long",
          entryPrice: 300,
          benchmarkEntryPrice: 300,
        },
      });
      appendReflectionRecord(path, {
        schemaVersion: 1,
        resolvedDecisionHash: alreadyResolved.hash,
        outcome: outcomeFor(alreadyResolved.hash, "NVDAUSDT"),
        lesson: "Already resolved.",
        artifact: {
          label: "LLM_REFLECTION",
          promptVersion: "reflection-memory-v1",
          generatedAt: "2026-06-24T15:30:00.000Z",
          text: "Already resolved.",
        },
      });

      const resolved = resolveDueDecisions({
        records: readReflectionChain(path),
        now: "2026-06-24T10:00:01.000Z",
        holdingWindowMs: 60_000,
        benchmarkName: "underlying",
        priceResolver: (_record, decision) =>
          decision.hash === due.hash
            ? {
                exitTs: "2026-06-24T15:30:00.000Z",
                exitPrice: 105,
                benchmarkExitPrice: 202,
              }
            : {
                exitTs: "2026-06-24T15:30:00.000Z",
                exitPrice: 305,
                benchmarkExitPrice: 306,
              },
      });

      expect(resolved).toHaveLength(1);
      expect(resolved[0].record.hash).toBe(due.hash);
      expect(resolved[0].outcome.rawReturnPct).toBe(5);
      expect(resolved[0].outcome.benchmarkReturnPct).toBe(1);
      expect(resolved[0].outcome.alphaPct).toBe(4);
    } finally {
      cleanup(dir);
    }
  });

  it("appends a labeled LLM reflection artifact without mutating existing chain rows", async () => {
    const { dir, path } = tempChain();
    try {
      const decision = appendMemoryRecord(path, {
        agentId: "quorum-rwa-desk",
        kind: "quorum_decision",
        ts: "2026-06-24T00:00:00.000Z",
        payload: {
          symbol: "AAPLUSDT",
          direction: "long",
          entryPrice: 100,
          benchmarkEntryPrice: 200,
        },
      });
      const originalLine = readFileSync(path, "utf8").trim();
      const payload = await generateReflectionPayload({
        decision,
        outcome: outcomeFor(decision.hash),
        model: "stub-reflector",
        generatedAt: "2026-06-24T15:31:00.000Z",
        reflect: async (messages) => {
          expect(messages[0].content).toContain("2-4 sentences");
          expect(messages[1].content).toContain("LLM_REFLECTION");
          expect(messages[1].content).toContain(decision.hash);
          return "The long call was right with +4.000% alpha. Liquidity noise reverted while the benchmark barely moved. Lesson: keep fading quiet rich gaps only after checking catalyst silence.";
        },
      });

      expect(payload.artifact).toMatchObject({
        label: "LLM_REFLECTION",
        promptVersion: "reflection-memory-v1",
        model: "stub-reflector",
      });

      const reflection = appendReflectionRecord(path, payload, {
        agentId: "reflection-memory",
        ts: payload.artifact.generatedAt,
      });
      const lines = readFileSync(path, "utf8").trim().split(/\r?\n/);

      expect(lines[0]).toBe(originalLine);
      expect(reflection.prevHash).toBe(decision.hash);
      expect(reflection.kind).toBe("reflection");
      expect(verifyReflectionRecords(readReflectionChain(path))).toMatchObject({
        ok: true,
        count: 2,
        errors: [],
      });
    } finally {
      cleanup(dir);
    }
  });

  it("selects same and cross-instrument lessons and injects them into the gate prompt", () => {
    const { dir, path } = tempChain();
    try {
      const aapl = appendMemoryRecord(path, {
        agentId: "quorum-rwa-desk",
        kind: "quorum_decision",
        ts: "2026-06-24T00:00:00.000Z",
        payload: {
          symbol: "AAPLUSDT",
          direction: "long",
          entryPrice: 100,
          benchmarkEntryPrice: 200,
        },
      });
      appendReflectionRecord(path, {
        schemaVersion: 1,
        resolvedDecisionHash: aapl.hash,
        outcome: outcomeFor(aapl.hash, "AAPLUSDT"),
        lesson:
          "Quiet rich gaps can fade, but only after catalyst silence is verified.",
        artifact: {
          label: "LLM_REFLECTION",
          promptVersion: "reflection-memory-v1",
          generatedAt: "2026-06-24T15:30:00.000Z",
          text: "Quiet rich gaps can fade, but only after catalyst silence is verified.",
        },
      });
      const nvda = appendMemoryRecord(path, {
        agentId: "quorum-rwa-desk",
        kind: "quorum_decision",
        ts: "2026-06-24T00:00:00.000Z",
        payload: {
          symbol: "NVDAUSDT",
          direction: "short",
          entryPrice: 300,
          benchmarkEntryPrice: 300,
        },
      });
      appendReflectionRecord(path, {
        schemaVersion: 1,
        resolvedDecisionHash: nvda.hash,
        outcome: {
          ...outcomeFor(nvda.hash, "NVDAUSDT"),
          rawReturnPct: -2,
          benchmarkReturnPct: 1,
          alphaPct: -3,
        },
        lesson:
          "Earnings momentum punished the fade; stand aside on hard catalysts.",
        artifact: {
          label: "LLM_REFLECTION",
          promptVersion: "reflection-memory-v1",
          generatedAt: "2026-06-24T15:31:00.000Z",
          text: "Earnings momentum punished the fade; stand aside on hard catalysts.",
        },
      });

      const reflectionLessons = selectReflectionLessons(
        readReflectionChain(path),
        "AAPLUSDT",
        { sameInstrumentLimit: 1, crossInstrumentLimit: 1 },
      );
      const user = buildMessages({
        ...gateContext,
        reflectionLessons,
      })[1].content;

      expect(reflectionLessons.sameInstrument).toHaveLength(1);
      expect(reflectionLessons.crossInstrument).toHaveLength(1);
      expect(user).toContain("REFLECTION_MEMORY");
      expect(user).toContain("SAME_INSTRUMENT:");
      expect(user).toContain("AAPLUSDT");
      expect(user).toContain("alpha +4.000%");
      expect(user).toContain("CROSS_INSTRUMENT:");
      expect(user).toContain("NVDAUSDT");
      expect(user).toContain("alpha -3.000%");
      expect(user).toContain("LLM_REFLECTION");
    } finally {
      cleanup(dir);
    }
  });
});
