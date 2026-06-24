import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { assessRwaMarketFreshness } from "./evidence";
import { assessNewsFeedFreshness } from "./newsFeed";
import {
  readSubmissionManifest,
  verifySubmissionManifest,
} from "./submissionManifest";

type UnknownRecord = Record<string, unknown>;

export type ReadinessStatus = "pass" | "warn" | "fail";

export interface ReadinessCheck {
  id: string;
  status: ReadinessStatus;
  detail: string;
}

export interface ReadinessReport {
  ok: boolean;
  generatedAt: string;
  checks: ReadinessCheck[];
}

const REQUIRED_LOCAL_EVIDENCE = [
  "public/arena.html",
  "public/arena-data.json",
  "public/arena-chain.jsonl",
  "public/arena-attestation.json",
  "public/arena-pubkey.pem",
  "public/rwa-market.json",
  "public/news.html",
  "public/news-feed.json",
  "data/aaplusdt-gate-verdicts.json",
  "data/aaplusdt-news-contexts.json",
  "data/aaplusdt-gate-labels.json",
  "data/macro-calendar.json",
  "artifacts/aaplusdt-backtest.json",
  "artifacts/aaplusdt-news-aware-backtest.json",
  "artifacts/aaplusdt-gate-audit.json",
  "artifacts/rwa-multi-backtest.json",
  "artifacts/rwa-alpha-certification.json",
  "artifacts/paper-btc-smoke.jsonl",
  "playbook/aaplusdt-backtest-result.json",
  "submission-manifest.json",
  "SECURITY.md",
  ".env.example",
];

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function readJson(path: string): UnknownRecord | null {
  const fullPath = resolve(path);
  if (!existsSync(fullPath)) return null;
  return asRecord(JSON.parse(readFileSync(fullPath, "utf8")));
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function gitTrackedFiles(): Set<string> {
  const result = spawnSync("git", ["ls-files"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  if (result.status !== 0) return new Set();
  return new Set(
    result.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean),
  );
}

function localEvidenceChecks(paths: string[], tracked: Set<string>): ReadinessCheck[] {
  const missing = paths.filter((path) => !existsSync(resolve(path)));
  const untracked = paths.filter(
    (path) => existsSync(resolve(path)) && !tracked.has(path),
  );
  const checks: ReadinessCheck[] = [
    {
      id: "local-evidence-present",
      status: missing.length === 0 ? "pass" : "fail",
      detail: missing.length === 0 ? "all critical local evidence files exist" : `missing: ${missing.join(", ")}`,
    },
  ];
  checks.push({
    id: "local-evidence-tracked",
    status: untracked.length === 0 ? "pass" : "warn",
    detail:
      untracked.length === 0
        ? "all critical local evidence files are git-tracked"
        : `not tracked yet: ${untracked.join(", ")}`,
  });
  return checks;
}

function arenaEvidenceChecks(path = "public/arena-data.json"): ReadinessCheck[] {
  const arena = readJson(path);
  if (!arena) {
    return [
      {
        id: "arena-data",
        status: "fail",
        detail: `${path} is missing or unreadable`,
      },
    ];
  }

  const status = asRecord(arena.status);
  const leaderboard = Array.isArray(arena.leaderboard)
    ? arena.leaderboard.map(asRecord)
    : [];
  const quorum = leaderboard.find(
    (passport) => readString(passport.agentId) === "quorum-rwa-desk",
  );
  const evidence = asRecord(quorum?.evidence);
  const backtest = asRecord(evidence.backtest);
  const alphaStatus = readString(backtest.alphaStatus);
  const backtestSharpe = readNumber(evidence.backtestSharpe);
  const liveStatus = readString(status.liveStatus);
  const alphaGateConsistent =
    (alphaStatus === "positive" && liveStatus === "gated") ||
    ((alphaStatus === "negative" || alphaStatus === "unproven") &&
      liveStatus === "disabled_alpha_unproven");
  const sharpeConsistent =
    typeof backtestSharpe === "number" &&
    (alphaStatus === "positive" ? backtestSharpe > 0 : backtestSharpe <= 0);

  return [
    {
      id: "arena-alpha-status",
      status: alphaGateConsistent ? "pass" : "fail",
      detail: `alphaStatus=${alphaStatus ?? "missing"}, liveStatus=${liveStatus ?? "missing"}`,
    },
    {
      id: "arena-sharpe-alignment",
      status: sharpeConsistent ? "pass" : "fail",
      detail: `quorum backtestSharpe=${backtestSharpe ?? "missing"}`,
    },
  ];
}

function brokerBoundaryChecks(path = "public/arena-chain.jsonl"): ReadinessCheck[] {
  const fullPath = resolve(path);
  if (!existsSync(fullPath)) {
    return [
      {
        id: "broker-boundary",
        status: "fail",
        detail: `${path} is missing`,
      },
    ];
  }
  const records = readFileSync(fullPath, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => asRecord(JSON.parse(line)));
  const brokers = records.filter((record) => record.kind === "broker_order");
  if (brokers.length === 0) {
    return [
      {
        id: "sim-broker-dry-run-boundary",
        status: "fail",
        detail: "no broker_order record found",
      },
    ];
  }
  const unsafe = brokers
    .map((broker, index) => {
      const payload = asRecord(broker.payload);
      const plan = asRecord(payload.plan);
      return {
        index: index + 1,
        mode: readString(plan.mode),
        status: readString(payload.status),
      };
    })
    .filter(
      (broker) => broker.mode !== "dry_run" || broker.status !== "dry_run",
    );
  return [
    {
      id: "sim-broker-dry-run-boundary",
      status: unsafe.length === 0 ? "pass" : "fail",
      detail:
        unsafe.length === 0
          ? `${brokers.length} broker record(s), all dry_run`
          : `non-dry-run broker records: ${unsafe
              .map(
                (broker) =>
                  `#${broker.index} mode=${broker.mode ?? "missing"} status=${broker.status ?? "missing"}`,
              )
              .join(", ")}`,
    },
  ];
}

function rwaFreshnessChecks(): ReadinessCheck[] {
  const freshness = assessRwaMarketFreshness();
  return [
    {
      id: "rwa-market-freshness",
      status: freshness.status === "fresh" ? "pass" : "fail",
      detail:
        freshness.ageMinutes === null
          ? `status=${freshness.status}`
          : `status=${freshness.status}, age=${freshness.ageMinutes}m, max=${freshness.maxAgeMinutes}m`,
    },
  ];
}

function newsFeedFreshnessChecks(): ReadinessCheck[] {
  const freshness = assessNewsFeedFreshness();
  return [
    {
      id: "news-feed-freshness",
      status:
        freshness.status === "fresh"
          ? "pass"
          : freshness.status === "invalid"
            ? "fail"
            : "warn",
      detail:
        freshness.ageMinutes === null
          ? `status=${freshness.status}`
          : `status=${freshness.status}, age=${freshness.ageMinutes}m, max=${freshness.maxAgeMinutes}m`,
    },
  ];
}

function submissionManifestChecks(): ReadinessCheck[] {
  const path = "submission-manifest.json";
  if (!existsSync(resolve(path))) {
    return [
      {
        id: "submission-manifest",
        status: "fail",
        detail: `${path} is missing`,
      },
    ];
  }
  const errors = verifySubmissionManifest(readSubmissionManifest(path));
  return [
    {
      id: "submission-manifest",
      status: errors.length === 0 ? "pass" : "fail",
      detail:
        errors.length === 0
          ? "artifact hashes and signing-key fingerprint match"
          : errors.join("; "),
    },
  ];
}

export function buildReadinessReport(
  generatedAt = new Date().toISOString(),
): ReadinessReport {
  const checks = [
    ...localEvidenceChecks(REQUIRED_LOCAL_EVIDENCE, gitTrackedFiles()),
    ...arenaEvidenceChecks(),
    ...brokerBoundaryChecks(),
    ...rwaFreshnessChecks(),
    ...newsFeedFreshnessChecks(),
    ...submissionManifestChecks(),
  ];
  return {
    ok: checks.every((check) => check.status !== "fail"),
    generatedAt,
    checks,
  };
}

export function formatReadinessReport(report: ReadinessReport): string {
  const lines = [
    `GapGuard readiness: ${report.ok ? "PASS" : "BLOCKED"}`,
    ...report.checks.map(
      (check) => `${check.status.toUpperCase()} ${check.id}: ${check.detail}`,
    ),
  ];
  return lines.join("\n");
}
