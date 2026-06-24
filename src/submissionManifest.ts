import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { mkdirSync } from "node:fs";
import { publicKeyFingerprint, readArenaPublicKey } from "./arenaSigning";

const DEFAULT_ARTIFACTS = [
  "README.md",
  "docs/SUBMISSION.md",
  "docs/METRICS.md",
  "public/index.html",
  "public/arena.html",
  "public/arena-data.json",
  "public/arena-chain.jsonl",
  "public/arena-attestation.json",
  "public/arena-pubkey.pem",
  "public/metrics.json",
  "public/dashboard-data.json",
  "glassbox-demo.jsonl",
  "artifacts/stock-paper-journal.jsonl",
  "artifacts/stock-paper-journal.csv",
  "artifacts/aaplusdt-news-aware-backtest.json",
  "artifacts/aaplusdt-gate-audit.json",
  "artifacts/gate-holdout-report.json",
  "artifacts/rwa-multi-backtest.json",
  "artifacts/rwa-alpha-certification.json",
  "artifacts/paper-btc-smoke.jsonl",
];

const GENERATION_COMMANDS = [
  "npm run replay:proof -- data/tslax-replay.json glassbox-demo.jsonl public/dashboard-data.json",
  "npm run paper:journal",
  "npm run backtest:news",
  "npm run gate:holdout",
  "npm run alpha:certify",
  "npm run arena:cockpit",
  "npm run evidence",
  "npm run manifest",
];

export interface ManifestArtifact {
  path: string;
  sha256: string;
  bytes: number;
}

export interface SubmissionManifest {
  schemaVersion: 1;
  createdAt: string;
  commit: string;
  dirty: boolean;
  model: string;
  promptSource: string;
  promptHash: string;
  publicKeyFingerprint: string;
  artifacts: ManifestArtifact[];
  generationCommands: string[];
}

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(resolve(path))).digest("hex");
}

function fileSize(path: string): number {
  return readFileSync(resolve(path)).byteLength;
}

function git(args: string[]): string {
  const result = spawnSync("git", args, {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  return result.status === 0 ? result.stdout.trim() : "unknown";
}

function stableCreatedAt(): string {
  const attestationPath = resolve("public/arena-attestation.json");
  if (existsSync(attestationPath)) {
    const attestation = JSON.parse(readFileSync(attestationPath, "utf8")) as {
      signedAt?: unknown;
    };
    if (typeof attestation.signedAt === "string") return attestation.signedAt;
  }
  return new Date().toISOString();
}

export function buildSubmissionManifest(
  artifactPaths = DEFAULT_ARTIFACTS,
): SubmissionManifest {
  const missing = artifactPaths.filter((path) => !existsSync(resolve(path)));
  if (missing.length > 0) {
    throw new Error(`submission manifest missing artifacts: ${missing.join(", ")}`);
  }
  const status = git(["status", "--porcelain"]);
  return {
    schemaVersion: 1,
    createdAt: stableCreatedAt(),
    commit: git(["rev-parse", "HEAD"]),
    dirty: status.length > 0,
    model: "Qwen catalyst gate + deterministic Quorum",
    promptSource: "src/convergenceGate.ts",
    promptHash: sha256File("src/convergenceGate.ts"),
    publicKeyFingerprint: publicKeyFingerprint(readArenaPublicKey()),
    artifacts: artifactPaths.map((path) => ({
      path,
      sha256: sha256File(path),
      bytes: fileSize(path),
    })),
    generationCommands: GENERATION_COMMANDS,
  };
}

export function writeSubmissionManifest(
  outPath = "submission-manifest.json",
): SubmissionManifest {
  const manifest = buildSubmissionManifest();
  mkdirSync(dirname(resolve(outPath)), { recursive: true });
  writeFileSync(resolve(outPath), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

export function readSubmissionManifest(
  path = "submission-manifest.json",
): SubmissionManifest {
  return JSON.parse(readFileSync(resolve(path), "utf8")) as SubmissionManifest;
}

export function verifySubmissionManifest(
  manifest: SubmissionManifest,
): string[] {
  const errors: string[] = [];
  for (const artifact of manifest.artifacts) {
    if (!existsSync(resolve(artifact.path))) {
      errors.push(`${artifact.path}: missing`);
      continue;
    }
    const actual = sha256File(artifact.path);
    if (actual !== artifact.sha256) {
      errors.push(`${artifact.path}: sha256 mismatch`);
    }
  }
  const promptHash = sha256File(manifest.promptSource);
  if (promptHash !== manifest.promptHash) {
    errors.push(`${manifest.promptSource}: promptHash mismatch`);
  }
  const fingerprint = publicKeyFingerprint(readArenaPublicKey());
  if (fingerprint !== manifest.publicKeyFingerprint) {
    errors.push("public/arena-pubkey.pem: fingerprint mismatch");
  }
  return errors;
}

export function runSubmissionManifestCli(): void {
  const check = process.argv.includes("--check");
  const outPath = "submission-manifest.json";
  if (check) {
    const errors = verifySubmissionManifest(readSubmissionManifest(outPath));
    if (errors.length > 0) {
      throw new Error(`submission manifest drift:\n${errors.join("\n")}`);
    }
    console.log("submission manifest check: OK");
    return;
  }

  const manifest = writeSubmissionManifest(outPath);
  console.log(
    `submission manifest: ${outPath} (${manifest.artifacts.length} artifacts, key ${manifest.publicKeyFingerprint.slice(0, 12)}...)`,
  );
}

if (process.argv[1]?.endsWith("submissionManifest.ts")) {
  runSubmissionManifestCli();
}
