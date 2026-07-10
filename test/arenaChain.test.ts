import { generateKeyPairSync, webcrypto } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  acquireAutoTraderLock,
  releaseAutoTraderLock,
} from "../src/autoTraderState";
import { GENESIS_HASH } from "../src/glassbox";
import {
  appendAttestedArenaRecord,
  attestChain,
  readArenaChain,
  replaceAttestedArenaRecords,
  sealArenaRecords,
  validateAttestedArenaPreflight,
  verifyArenaRecords,
  verifyAttestation,
  writeArenaChain,
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

function attestedFixture() {
  const dir = mkdtempSync(join(tmpdir(), "gapguard-arena-attested-"));
  const chainPath = join(dir, "arena-chain.jsonl");
  const attestationPath = join(dir, "arena-attestation.json");
  const publicKeyPath = join(dir, "arena-pubkey.pem");
  const privateKeyPath = join(dir, "arena-private.pem");
  const lockPath = join(dir, "arena-chain.lock");
  const pair = generateKeyPairSync("ed25519");
  const records = sealArenaRecords([
    {
      ts: "2026-07-10T00:00:00.000Z",
      kind: "quorum_decision",
      agentId: "quorum",
      payload: { vote: "flat", multiplier: 0 },
    },
  ]);
  writeArenaChain(chainPath, records);
  writeFileSync(
    attestationPath,
    `${JSON.stringify(
      attestChain(records, {
        signedAt: "2026-07-10T00:00:00.000Z",
        privateKey: pair.privateKey,
      }),
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    publicKeyPath,
    pair.publicKey.export({ format: "pem", type: "spki" }),
  );
  writeFileSync(
    privateKeyPath,
    pair.privateKey.export({ format: "pem", type: "pkcs8" }),
  );
  return {
    dir,
    pair,
    records,
    config: {
      chainPath,
      attestationPath,
      publicKeyPath,
      lockPath,
      env: { ARENA_SIGNING_KEY_FILE: privateKeyPath },
      model: "GapGuard test append",
    },
  };
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

  it("atomically replaces the chain and cleans a failed temporary write", () => {
    const dir = mkdtempSync(join(tmpdir(), "gapguard-arena-atomic-"));
    const records = sealArenaRecords([
      {
        ts: "2026-07-10T00:00:00.000Z",
        kind: "broker_order",
        agentId: "quorum",
        payload: { status: "dry_run" },
      },
    ]);
    const path = join(dir, "arena-chain.jsonl");
    writeArenaChain(path, records);
    expect(readArenaChain(path)).toEqual(records);
    expect(readdirSync(dir).filter((name) => name.endsWith(".tmp"))).toEqual([]);

    const blockedPath = join(dir, "blocked-chain.jsonl");
    mkdirSync(blockedPath);
    expect(() => writeArenaChain(blockedPath, records)).toThrow();
    expect(
      readdirSync(dir).filter((name) => name.startsWith(".blocked-chain.jsonl")),
    ).toEqual([]);
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

  it("validates and appends one record under an attested exclusive lock", () => {
    const fixture = attestedFixture();
    expect(
      validateAttestedArenaPreflight(
        fixture.config,
        new Date("2026-07-11T00:00:00.000Z"),
      ),
    ).toMatchObject({ recordCount: 1 });

    const appended = appendAttestedArenaRecord(
      {
        ts: "2026-07-11T00:00:00.000Z",
        kind: "broker_order",
        agentId: "quorum",
        payload: { trigger: "auto", status: "filled" },
      },
      fixture.config,
    );
    const persisted = readArenaChain(fixture.config.chainPath);
    const persistedAttestation = JSON.parse(
      readFileSync(fixture.config.attestationPath, "utf8"),
    );

    expect(appended.records).toEqual(persisted);
    expect(persisted).toHaveLength(2);
    expect(
      verifyAttestation(persisted, persistedAttestation, {
        publicKey: fixture.pair.publicKey,
      }).ok,
    ).toBe(true);
    expect(existsSync(fixture.config.lockPath)).toBe(false);
    expect(readdirSync(fixture.dir).filter((name) => name.endsWith(".tmp"))).toEqual(
      [],
    );
  });

  it("replaces an attested chain under the same validated exclusive lock", () => {
    const fixture = attestedFixture();
    const replaced = replaceAttestedArenaRecords(
      (existing) => [
        ...existing.map(({ ts, kind, agentId, payload }) => ({
          ts,
          kind,
          agentId,
          payload,
        })),
        {
          ts: "2026-07-11T00:00:00.000Z",
          kind: "broker_order",
          agentId: "quorum",
          payload: { mode: "live", status: "filled" },
        },
      ],
      fixture.config,
      new Date("2026-07-11T00:00:00.000Z"),
    );

    expect(replaced.records).toHaveLength(2);
    expect(
      verifyAttestation(replaced.records, replaced.attestation, {
        publicKey: fixture.pair.publicKey,
      }).ok,
    ).toBe(true);
    expect(existsSync(fixture.config.lockPath)).toBe(false);
  });

  it("rejects invalid existing attestations and signing-key mismatches", () => {
    const invalidPublishedKey = attestedFixture();
    const other = generateKeyPairSync("ed25519");
    writeFileSync(
      invalidPublishedKey.config.publicKeyPath,
      other.publicKey.export({ format: "pem", type: "spki" }),
    );
    expect(() =>
      validateAttestedArenaPreflight(invalidPublishedKey.config),
    ).toThrow("existing Arena attestation verification failed");

    const invalidSigningKey = attestedFixture();
    const otherPrivateKeyPath = join(invalidSigningKey.dir, "other-private.pem");
    writeFileSync(
      otherPrivateKeyPath,
      other.privateKey.export({ format: "pem", type: "pkcs8" }),
    );
    expect(() =>
      validateAttestedArenaPreflight({
        ...invalidSigningKey.config,
        env: { ARENA_SIGNING_KEY_FILE: otherPrivateKeyPath },
      }),
    ).toThrow("signing key does not match published public key");
  });

  it("blocks overlapping attested appends without stealing the lock", () => {
    const fixture = attestedFixture();
    const now = new Date("2026-07-11T00:00:00.000Z");
    const held = acquireAutoTraderLock(
      fixture.config.lockPath,
      now,
      600_000,
      { ownerToken: "existing-owner", pid: 101 },
    );
    if (!held.acquired) throw new Error("expected lock acquisition");

    expect(() =>
      appendAttestedArenaRecord(
        {
          ts: now.toISOString(),
          kind: "broker_order",
          agentId: "quorum",
          payload: { trigger: "auto", status: "submitted" },
        },
        fixture.config,
      ),
    ).toThrow("auto-trader lock is active");
    expect(existsSync(fixture.config.lockPath)).toBe(true);
    expect(releaseAutoTraderLock(held.lock)).toBe(true);
  });
});
