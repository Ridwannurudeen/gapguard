import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { assessRwaMarketFreshness, type RwaFreshnessSummary } from "./evidence";

/**
 * A health surface for the cron-owned live feeds. The read plane already refuses
 * to overwrite a good live-calls.json with a degraded one (see
 * chooseLiveCallsReport in buildLiveCalls.ts); this report makes that state, and
 * the freshness of every feed, observable in one place so a stalled cron or an
 * expired gate key can never silently masquerade as "live".
 */

export type OverallHealth = "healthy" | "degraded" | "down";

export interface StatusFeed {
  id: string;
  label: string;
  path: string;
  status: RwaFreshnessSummary["status"];
  generatedAt: string | null;
  ageMinutes: number | null;
  maxAgeMinutes: number;
}

export interface GateHealth {
  state: string;
  reason: string;
  keyExpiresAt: string | null;
  verdicts: number;
  retainedPreviousGood: boolean;
}

export interface StatusReport {
  generatedAt: string;
  overall: OverallHealth;
  feeds: StatusFeed[];
  gate: GateHealth | null;
}

export interface FeedSpec {
  id: string;
  label: string;
  path: string;
  maxAgeMinutes: number;
}

/** The three feeds a VPS cron refreshes; each carries a top-level generatedAt. */
export const DEFAULT_FEED_SPECS: FeedSpec[] = [
  {
    id: "rwa-market",
    label: "RWA market snapshot",
    path: "public/rwa-market.json",
    maxAgeMinutes: 30,
  },
  {
    id: "news-feed",
    label: "Operational news feed",
    path: "public/news-feed.json",
    maxAgeMinutes: 30,
  },
  {
    id: "live-calls",
    label: "Live gate calls",
    path: "public/live-calls.json",
    maxAgeMinutes: 30,
  },
];

function feedFreshness(spec: FeedSpec, now: Date): StatusFeed {
  const freshness = assessRwaMarketFreshness(
    spec.path,
    now,
    spec.maxAgeMinutes,
  );
  return {
    id: spec.id,
    label: spec.label,
    path: spec.path,
    status: freshness.status,
    generatedAt: freshness.generatedAt,
    ageMinutes: freshness.ageMinutes,
    maxAgeMinutes: freshness.maxAgeMinutes,
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readGateHealth(path: string): GateHealth | null {
  const full = resolve(path);
  if (!existsSync(full)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(full, "utf8"));
  } catch {
    return null;
  }
  const gateStatus = asRecord(asRecord(parsed).gateStatus);
  if (typeof gateStatus.state !== "string") return null;
  return {
    state: gateStatus.state,
    reason: typeof gateStatus.reason === "string" ? gateStatus.reason : "",
    keyExpiresAt:
      typeof gateStatus.keyExpiresAt === "string"
        ? gateStatus.keyExpiresAt
        : null,
    verdicts: typeof gateStatus.verdicts === "number" ? gateStatus.verdicts : 0,
    retainedPreviousGood: gateStatus.retainedPreviousGood === true,
  };
}

export function buildStatusReport(
  feeds: StatusFeed[],
  gate: GateHealth | null,
  generatedAt = new Date().toISOString(),
): StatusReport {
  const anyDown = feeds.some(
    (feed) => feed.status === "missing" || feed.status === "invalid",
  );
  const anyStale = feeds.some((feed) => feed.status === "stale");
  const gateHealthy = gate === null || gate.state === "live";
  const overall: OverallHealth = anyDown
    ? "down"
    : anyStale || !gateHealthy
      ? "degraded"
      : "healthy";
  return { generatedAt, overall, feeds, gate };
}

export function loadStatusReport(
  now = new Date(),
  specs: FeedSpec[] = DEFAULT_FEED_SPECS,
  gatePath = "public/live-calls.json",
): StatusReport {
  const feeds = specs.map((spec) => feedFreshness(spec, now));
  const gate = readGateHealth(gatePath);
  return buildStatusReport(feeds, gate, now.toISOString());
}

export function runStatusReportCli(): void {
  const out = resolve(process.argv[2] ?? "artifacts/status.json");
  const report = loadStatusReport();
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
  const feedSummary = report.feeds
    .map((feed) => `${feed.id}=${feed.status}`)
    .join(", ");
  console.log(
    `status: ${report.overall}; ${feedSummary}; gate=${report.gate?.state ?? "n/a"} -> ${out}`,
  );
}

if (process.argv[1]?.endsWith("buildStatusReport.ts")) {
  runStatusReportCli();
}
