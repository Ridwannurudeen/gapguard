import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

type UnknownRecord = Record<string, unknown>;

const CRITICAL_EVIDENCE_FILES = [
  "public/rwa-market.json",
  "public/arena-data.json",
  "public/arena-chain.jsonl",
  "public/arena-attestation.json",
  "public/dashboard-data.json",
  "artifacts/aaplusdt-backtest.json",
  "artifacts/aaplusdt-news-aware-backtest.json",
  "artifacts/rwa-alpha-certification.json",
  "playbook/aaplusdt-backtest-result.json",
] as const;

function repoPath(path: string): string {
  return resolve(process.cwd(), path);
}

function git(args: string[], allowExitOne = false): string {
  const result = spawnSync("git", args, {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  if (result.error) throw result.error;
  if (result.status !== 0 && !(allowExitOne && result.status === 1)) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  }
  return result.stdout.trim();
}

function splitLines(value: string): string[] {
  return value.length > 0 ? value.split(/\r?\n/) : [];
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(repoPath(path), "utf8")) as unknown;
}

function readJsonl(path: string): unknown[] {
  return readFileSync(repoPath(path), "utf8")
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as unknown);
}

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function getRecord(record: UnknownRecord, key: string): UnknownRecord {
  const value = asRecord(record[key]);
  expect(Object.keys(value), `${key} must be an object`).not.toHaveLength(0);
  return value;
}

function getArray(record: UnknownRecord, key: string): unknown[] {
  const value = record[key];
  expect(Array.isArray(value), `${key} must be an array`).toBe(true);
  return value as unknown[];
}

function getString(record: UnknownRecord, key: string): string {
  const value = record[key];
  expect(typeof value, `${key} must be a string`).toBe("string");
  return value as string;
}

function getNumber(record: UnknownRecord, key: string): number {
  const value = record[key];
  expect(typeof value, `${key} must be a number`).toBe("number");
  return value as number;
}

function rounded(value: number): number {
  return Number(value.toFixed(3));
}

function quorumPassport(arenaData: UnknownRecord): UnknownRecord {
  const leaderboard = getArray(arenaData, "leaderboard").map(asRecord);
  const quorum = leaderboard.find(
    (passport) => readString(passport.agentId) === "quorum-rwa-desk",
  );
  expect(quorum, "quorum passport must be present").toBeDefined();
  return quorum ?? {};
}

function sourceBacktestSharpes(): number[] {
  const basicBacktest = asRecord(readJson("artifacts/aaplusdt-backtest.json"));
  const newsAware = asRecord(
    readJson("artifacts/aaplusdt-news-aware-backtest.json"),
  );
  const alphaCertification = asRecord(
    readJson("artifacts/rwa-alpha-certification.json"),
  );
  const playbook = asRecord(readJson("playbook/aaplusdt-backtest-result.json"));
  const variants = getRecord(newsAware, "variants");
  const passportEvidence = getRecord(alphaCertification, "passportEvidence");
  const managedMetrics = getRecord(
    getRecord(getRecord(playbook, "data"), "metrics_output"),
    "summary",
  );

  return [
    getNumber(getRecord(basicBacktest, "metrics"), "sharpeAnnualized"),
    ...Object.values(variants)
      .map(asRecord)
      .map((variant) => getNumber(variant, "sharpeAnnualized")),
    getNumber(passportEvidence, "sharpeAnnualized"),
    getNumber(managedMetrics, "sharpe_ratio"),
  ];
}

describe("readiness evidence audit", () => {
  it("keeps critical evidence artifacts tracked and not ignored", () => {
    const tracked = new Set(
      splitLines(git(["ls-files", "--", ...CRITICAL_EVIDENCE_FILES])),
    );
    const untracked = splitLines(
      git(
        [
          "ls-files",
          "--others",
          "--exclude-standard",
          "--",
          ...CRITICAL_EVIDENCE_FILES,
        ],
        true,
      ),
    );
    const ignored = splitLines(
      git(["check-ignore", "-v", "--", ...CRITICAL_EVIDENCE_FILES], true),
    );

    expect(
      CRITICAL_EVIDENCE_FILES.filter((path) => !tracked.has(path)),
    ).toEqual([]);
    expect(untracked).toEqual([]);
    expect(ignored).toEqual([]);
  });

  it("keeps the public RWA market report embedded in arena data", () => {
    const market = asRecord(readJson("public/rwa-market.json"));
    const arenaData = asRecord(readJson("public/arena-data.json"));
    const embeddedMarket = getRecord(arenaData, "rwaMarket");
    const generatedAt = getString(market, "generatedAt");

    expect(getString(embeddedMarket, "generatedAt")).toBe(generatedAt);
    expect(getArray(market, "rows").length).toBeGreaterThan(0);
  });

  it("binds public arena backtestSharpe to a tracked backtest artifact", () => {
    const arenaData = asRecord(readJson("public/arena-data.json"));
    const publicSharpe = getNumber(
      getRecord(quorumPassport(arenaData), "evidence"),
      "backtestSharpe",
    );
    const trackedSharpes = sourceBacktestSharpes().map(rounded);

    expect(trackedSharpes).toContain(rounded(publicSharpe));
  });

  it("requires the public dry-run broker record to look simulated and non-executed", () => {
    const brokerRecords = readJsonl("public/arena-chain.jsonl")
      .map(asRecord)
      .filter((record) => readString(record.kind) === "broker_order");
    const brokerRecord = brokerRecords.at(-1);
    expect(brokerRecord, "broker_order record must be present").toBeDefined();

    const payload = getRecord(brokerRecord ?? {}, "payload");
    const plan = getRecord(payload, "plan");
    const fill = getRecord(payload, "fill");
    const stdout = asRecord(JSON.parse(getString(payload, "stdout")));
    const balanceBefore = getNumber(fill, "balanceBefore");
    const balanceAfter = getNumber(fill, "balanceAfter");

    expect(getString(plan, "mode")).toBe("dry_run");
    expect(getString(payload, "status")).toBe("dry_run");
    expect(getString(fill, "mode")).toBe("dry_run");
    expect(getString(fill, "orderId")).toMatch(/^SIM-[a-f0-9]{16}$/);
    expect(getString(stdout, "code")).toBe("SIMULATED");
    expect(balanceAfter - balanceBefore).toBeCloseTo(
      getNumber(fill, "balanceDelta"),
    );
  });
});
