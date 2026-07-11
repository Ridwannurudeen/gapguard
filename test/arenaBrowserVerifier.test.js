import { generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  GENESIS_HASH,
  canonicalJson,
  computeMerkleRoot,
  parseArenaJsonl,
  verifyArenaAttestation,
  verifyArenaChain,
  verifyPublishedArenaBinding,
} from "../public/arena-verifier.js";

const chainText = readFileSync("public/arena-chain.jsonl", "utf8");
const arenaData = JSON.parse(readFileSync("public/arena-data.json", "utf8"));
const attestation = JSON.parse(
  readFileSync("public/arena-attestation.json", "utf8"),
);
const publicKeyPem = readFileSync("public/arena-pubkey.pem", "utf8");
const arenaHtml = readFileSync("public/arena.html", "utf8");
const indexHtml = readFileSync("public/index.html", "utf8");

describe("browser Arena verifier", () => {
  it("verifies the current chain, Ed25519 attestation, and published-data binding", async () => {
    const records = parseArenaJsonl(chainText);
    const chain = await verifyArenaChain(records);
    const signature = await verifyArenaAttestation(
      records,
      attestation,
      publicKeyPem,
    );
    const binding = verifyPublishedArenaBinding(arenaData, records, chain);

    expect(chain).toMatchObject({
      ok: true,
      count: 10,
      finalHash:
        "ce22e2cca7ee48d470efe96d6cd378f6b3830a0a11c463fc27365d1fd1fe299c",
      errors: [],
      brokenRows: [],
    });
    expect(signature).toMatchObject({
      ok: true,
      merkleRootOk: true,
      signatureOk: true,
      publicKeyOk: true,
      recordCountOk: true,
    });
    expect(await computeMerkleRoot(records)).toBe(attestation.merkleRoot);
    expect(binding).toMatchObject({
      ok: true,
      decisionMatchOk: true,
      instrumentOk: true,
      recordCountOk: true,
      finalHashOk: true,
    });
    expect(binding.decision).toMatchObject({
      symbol: "NVDAUSDT",
      winningVote: "flat",
      consensusScore: 1,
      positionMultiplier: 0,
    });
  });

  it("detects a mutated signed payload in both the chain and Merkle root", async () => {
    const records = parseArenaJsonl(chainText);
    const mutated = structuredClone(records);
    mutated[3].payload.decision.winningVote = "long";

    const chain = await verifyArenaChain(mutated);
    const signature = await verifyArenaAttestation(
      mutated,
      attestation,
      publicKeyPem,
    );
    const binding = verifyPublishedArenaBinding(arenaData, mutated, chain);

    expect(chain.ok).toBe(false);
    expect(chain.brokenRows).toContain(4);
    expect(signature.merkleRootOk).toBe(false);
    expect(signature.ok).toBe(false);
    expect(binding.ok).toBe(false);
  });

  it("rejects a forged public key even when the published chain is intact", async () => {
    const records = parseArenaJsonl(chainText);
    const { publicKey } = generateKeyPairSync("ed25519");
    const forgedPem = publicKey.export({ type: "spki", format: "pem" });
    const result = await verifyArenaAttestation(
      records,
      attestation,
      forgedPem,
    );

    expect(result.merkleRootOk).toBe(true);
    expect(result.publicKeyOk).toBe(false);
    expect(result.signatureOk).toBe(false);
    expect(result.ok).toBe(false);
  });

  it("keeps a data-only mutation cryptographically valid but breaks display binding", async () => {
    const records = parseArenaJsonl(chainText);
    const chain = await verifyArenaChain(records);
    const signature = await verifyArenaAttestation(
      records,
      attestation,
      publicKeyPem,
    );
    const mutatedData = structuredClone(arenaData);
    mutatedData.quorum.consensusScore = 0.42;

    expect(chain.ok).toBe(true);
    expect(signature.ok).toBe(true);
    expect(
      verifyPublishedArenaBinding(mutatedData, records, chain),
    ).toMatchObject({ ok: false, decisionMatchOk: false });
  });

  it("fails closed on malformed or empty JSONL and mismatched metadata", async () => {
    expect(() => parseArenaJsonl('{"broken":')).toThrow(/line 1/);
    expect(await verifyArenaChain([])).toMatchObject({
      ok: false,
      count: 0,
      finalHash: GENESIS_HASH,
    });

    const records = parseArenaJsonl(chainText);
    const chain = await verifyArenaChain(records);
    const wrongCount = structuredClone(arenaData);
    wrongCount.arenaChain.count += 1;
    expect(
      verifyPublishedArenaBinding(wrongCount, records, chain),
    ).toMatchObject({ ok: false, recordCountOk: false });
  });

  it("parses the latest three receipt kinds and preserves canonical ordering", () => {
    const records = parseArenaJsonl(chainText);
    expect(records.slice(-3).map(({ kind, hash }) => ({ kind, hash }))).toEqual([
      {
        kind: "mandate_breach",
        hash: "4f224cfdd7595282d614f2c80cacd230946507b51d38d449b8c218443e62a247",
      },
      {
        kind: "passport_issued",
        hash: "dc96be3e7741fa1d8ddb5a81d6baa53a84abe47a8bcb57b4965a03d47ec2189c",
      },
      {
        kind: "passport_issued",
        hash: "ce22e2cca7ee48d470efe96d6cd378f6b3830a0a11c463fc27365d1fd1fe299c",
      },
    ]);
    expect(canonicalJson({ z: 1, a: { y: 2, b: 3 } })).toBe(
      '{"a":{"b":3,"y":2},"z":1}',
    );
  });

  it("keeps the Arena and landing cockpit on the same verifier module", () => {
    for (const source of [arenaHtml, indexHtml]) {
      expect(source).toContain('from "./arena-verifier.js"');
      for (const helper of [
        "canonicalJson",
        "computeMerkleRoot",
        "parseArenaJsonl",
        "verifyArenaAttestation",
        "verifyArenaChain",
        "verifyPublishedArenaBinding",
      ]) {
        expect(source).not.toMatch(new RegExp(`function\\s+${helper}\\s*\\(`));
      }
    }
  });

  it("fails the landing cockpit closed until published proof is available", () => {
    expect(indexHtml).toContain("SAMPLE · DATA UNAVAILABLE");
    expect(indexHtml).toContain("PUBLISHED SNAPSHOT · UNVERIFIED");
    expect(indexHtml).toContain("DISPLAY DOES NOT MATCH SIGNED DECISION");
    expect(indexHtml).toContain("SIGNED SNAPSHOT VERIFIED");
    expect(indexHtml).toMatch(
      /id="heroVerifyButton"[^>]*disabled[^>]*>Verify signed snapshot<\/button>/,
    );
    expect(indexHtml).toMatch(
      /id="heroVerifyStatus"[^>]*aria-live="polite"/,
    );
    expect(indexHtml).toContain('fetch("arena-data.json"');
    expect(indexHtml).toContain('fetch("arena-chain.jsonl"');
    expect(indexHtml).toContain('fetch("arena-attestation.json"');
    expect(indexHtml).toContain('fetch("arena-pubkey.pem"');
    expect(indexHtml).toContain('id="metricsArtifactStamp"');

    const cockpitScript = indexHtml.slice(
      indexHtml.indexOf("const heroCockpit"),
      indexHtml.indexOf("function signedPct"),
    );
    expect(cockpitScript).not.toContain("innerHTML");
    expect(cockpitScript).toContain("textContent");
    expect(cockpitScript).toContain("replaceChildren");
  });

  it("limits proof motion to explicit verification and honors reduced motion", () => {
    expect(arenaHtml).not.toMatch(/setTimeout\(resolve,\s*220\)/);
    expect(arenaHtml).toContain("verify-sweep");
    expect(arenaHtml).toContain("showVerifySweep");
    expect(arenaHtml).toContain(
      'matchMedia("(prefers-reduced-motion: reduce)").matches',
    );
  });
});
