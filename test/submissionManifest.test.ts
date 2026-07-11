import { readFileSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildSubmissionManifest,
  verifySubmissionManifest,
} from "../src/submissionManifest";

describe("submission manifest", () => {
  it("pins both public browser verifier modules", () => {
    const paths = buildSubmissionManifest().artifacts.map(
      (artifact) => artifact.path,
    );

    expect(paths).toContain("public/arena-verifier.js");
    expect(paths).toContain("public/autopilot-status.js");
  });

  it("hashes declared artifacts and records the signing-key fingerprint", () => {
    const dir = mkdtempSync(join(tmpdir(), "gapguard-manifest-"));
    const artifact = join(dir, "artifact.txt");
    writeFileSync(artifact, "proof\n");

    const manifest = buildSubmissionManifest([artifact]);

    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.artifacts).toHaveLength(1);
    expect(manifest.artifacts[0].path).toBe(artifact);
    expect(manifest.artifacts[0].bytes).toBe(6);
    expect(manifest.publicKeyFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(verifySubmissionManifest(manifest)).toEqual([]);
  });

  it("detects artifact and public-key fingerprint drift", () => {
    const dir = mkdtempSync(join(tmpdir(), "gapguard-manifest-"));
    const artifact = join(dir, "artifact.txt");
    writeFileSync(artifact, "proof\n");
    const manifest = buildSubmissionManifest([artifact]);

    writeFileSync(artifact, "tampered\n");
    const errors = verifySubmissionManifest({
      ...manifest,
      publicKeyFingerprint: "0".repeat(64),
    });

    expect(errors).toContain(`${artifact}: sha256 mismatch`);
    expect(errors).toContain("public/arena-pubkey.pem: fingerprint mismatch");
    expect(readFileSync(artifact, "utf8")).toBe("tampered\n");
  });
});
