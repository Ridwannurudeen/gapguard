import { generateKeyPairSync, webcrypto } from "node:crypto";
import { describe, expect, it } from "vitest";
import { GENESIS_HASH } from "../src/glassbox";
import {
  attestChain,
  sealArenaRecords,
  verifyArenaRecords,
  verifyAttestation,
  type ArenaRecord,
} from "../src/arena-chain";

function browserCanonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("canonical JSON cannot encode non-finite numbers");
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => browserCanonicalJson(item)).join(",")}]`;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .filter((key) => record[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${browserCanonicalJson(record[key])}`)
      .join(",")}}`;
  }
  throw new Error(`canonical JSON cannot encode ${typeof value}`);
}

async function browserStyleHash(record: ArenaRecord): Promise<string> {
  const payload: Record<string, unknown> = { ...record };
  delete payload.hash;
  const digest = await webcrypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(browserCanonicalJson(payload)),
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
        payload: { symbol: "NVDAUSDT", nested: { z: 2, a: 1 }, size: "0.03" },
      },
    ]);

    await expect(browserStyleHash(record)).resolves.toBe(record.hash);
  });

  it("accepts append-only reflection records as signed Arena chain rows", () => {
    const records = sealArenaRecords([
      {
        ts: "2026-06-22T00:00:00.000Z",
        kind: "agent_decision",
        agentId: "quorum",
        payload: { symbol: "AAPLUSDT", action: "enter_long" },
      },
      {
        ts: "2026-06-23T00:00:00.000Z",
        kind: "reflection",
        agentId: "reflection-memory",
        payload: {
          resolvedDecisionHash: "a".repeat(64),
          alphaPct: 1.25,
          label: "LLM_REFLECTION",
          lesson: "Quiet rich gaps reverted after no catalyst.",
        },
      },
    ]);

    expect(records[1].prevHash).toBe(records[0].hash);
    expect(verifyArenaRecords(records)).toMatchObject({
      ok: true,
      count: 2,
      errors: [],
    });
  });
});

describe("arena attestation (Merkle + Ed25519)", () => {
  const records = sealArenaRecords([
    {
      ts: "2026-06-22T00:00:00.000Z",
      kind: "quorum_decision",
      agentId: "quorum",
      payload: { vote: "long", multiplier: 0.5 },
    },
    {
      ts: "2026-06-22T00:00:00.000Z",
      kind: "broker_order",
      agentId: "quorum",
      payload: { symbol: "AAPLUSDT", size: "0.03" },
    },
  ]);

  it("signs a Merkle root and verifies it", () => {
    const pair = generateKeyPairSync("ed25519");
    const att = attestChain(records, {
      signedAt: "2026-06-22T00:00:00.000Z",
      model: "qwen3.6-plus",
      privateKey: pair.privateKey,
    });
    expect(att.alg).toBe("Ed25519");
    expect(att.recordCount).toBe(2);
    expect(verifyAttestation(records, att, { publicKey: pair.publicKey })).toEqual({
      ok: true,
      merkleRootOk: true,
      signatureOk: true,
      publicKeyOk: true,
      recordCountOk: true,
      chainOk: true,
    });
  });

  it("rejects structurally invalid Arena records", () => {
    const invalid = {
      prevHash: GENESIS_HASH,
      hash: GENESIS_HASH,
    } as ArenaRecord;

    const result = verifyArenaRecords([invalid]);

    expect(result.ok).toBe(false);
    expect(result.errors.join(" | ")).toContain("kind is not a valid");
    expect(result.errors.join(" | ")).toContain("payload is required");
  });

  it("detects a tampered payload via Merkle-root mismatch", () => {
    const att = attestChain(records, { signedAt: "2026-06-22T00:00:00.000Z" });
    const tampered = [
      { ...records[0], payload: { vote: "short", multiplier: 1 } },
      records[1],
    ];
    const result = verifyAttestation(tampered, att);
    expect(result.merkleRootOk).toBe(false);
    expect(result.ok).toBe(false);
  });

  it("detects unsigned attestation metadata changes", () => {
    const att = attestChain(records, { signedAt: "2026-06-22T00:00:00.000Z" });
    const forged = { ...att, recordCount: 999 };
    const result = verifyAttestation(records, forged);

    expect(result.recordCountOk).toBe(false);
    expect(result.signatureOk).toBe(false);
    expect(result.ok).toBe(false);
  });

  it("rejects an attestation signed by a different published key", () => {
    const signer = generateKeyPairSync("ed25519");
    const published = generateKeyPairSync("ed25519");
    const att = attestChain(records, {
      signedAt: "2026-06-22T00:00:00.000Z",
      privateKey: signer.privateKey,
    });

    const result = verifyAttestation(records, att, {
      publicKey: published.publicKey,
    });

    expect(result.signatureOk).toBe(true);
    expect(result.publicKeyOk).toBe(false);
    expect(result.ok).toBe(false);
  });

  it("rejects a forged signature", () => {
    const att = attestChain(records, { signedAt: "2026-06-22T00:00:00.000Z" });
    const forged = {
      ...att,
      signatureB64: Buffer.from("not-a-real-signature").toString("base64"),
    };
    const result = verifyAttestation(records, forged);
    expect(result.signatureOk).toBe(false);
    expect(result.ok).toBe(false);
  });
});
