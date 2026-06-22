import { webcrypto } from "node:crypto";
import { describe, expect, it } from "vitest";
import { GENESIS_HASH } from "../src/glassbox";
import {
  sealArenaRecords,
  verifyArenaRecords,
  type ArenaRecord,
} from "../src/arena-chain";

async function browserStyleHash(record: ArenaRecord): Promise<string> {
  const payload: Record<string, unknown> = { ...record };
  delete payload.hash;
  const digest = await webcrypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(payload)),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

describe("arena chain", () => {
  it("seals Arena records on a genesis-anchored hash chain", () => {
    const records = sealArenaRecords([
      {
        ts: "2026-06-22T00:00:00.000Z",
        kind: "quorum_decision",
        agentId: "quorum",
        payload: { vote: "long", multiplier: 0.5 },
      },
      {
        ts: "2026-06-22T00:00:00.000Z",
        kind: "passport_issued",
        agentId: "quorum",
        payload: { grade: "LICENSED" },
      },
    ]);

    expect(records[0].prevHash).toBe(GENESIS_HASH);
    expect(records[1].prevHash).toBe(records[0].hash);
    expect(verifyArenaRecords(records)).toMatchObject({
      ok: true,
      count: 2,
      errors: [],
    });
  });

  it("detects payload tampering and broken linkage", () => {
    const records = sealArenaRecords([
      {
        ts: "2026-06-22T00:00:00.000Z",
        kind: "agent_decision",
        agentId: "naive",
        payload: { positionPct: 0.5 },
      },
      {
        ts: "2026-06-22T00:00:00.000Z",
        kind: "mandate_breach",
        agentId: "naive",
        payload: { rule: "position <= 20.0%" },
      },
    ]);
    const tampered = [
      { ...records[0], payload: { positionPct: 0.1 } },
      { ...records[1], prevHash: GENESIS_HASH },
    ];

    const result = verifyArenaRecords(tampered);
    expect(result.ok).toBe(false);
    expect(result.errors.some((error) => error.includes("hash"))).toBe(true);
    expect(result.errors.some((error) => error.includes("prevHash"))).toBe(
      true,
    );
  });

  it("matches the browser SubtleCrypto canonicalization", async () => {
    const [record] = sealArenaRecords([
      {
        ts: "2026-06-22T00:00:00.000Z",
        kind: "broker_order",
        agentId: "quorum",
        payload: { symbol: "NVDAUSDT", size: "0.03" },
      },
    ]);

    await expect(browserStyleHash(record)).resolves.toBe(record.hash);
  });
});
