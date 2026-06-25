import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fetchRwaMarketReport } from "./rwa-market";
import { loadNewsFeed, type NewsFeedItem } from "./newsFeed";
import { buildOperationalCatalystBundle } from "./catalystBundle";
import {
  assessConvergence,
  effectiveMultiplier,
  type GateContext,
} from "./convergenceGate";
import { qwenChat, qwenConfigFromEnv } from "./qwen";

/** Tokenized US-stock perps GapGuard watches for the consumer app. */
const TRACKED = [
  { sym: "NVDAUSDT", name: "Nvidia", ticker: "NVDA" },
  { sym: "MUUSDT", name: "Micron", ticker: "MU" },
  { sym: "SNDKUSDT", name: "SanDisk", ticker: "SNDK" },
  { sym: "SKHYNIXUSDT", name: "SK Hynix", ticker: "SKHYNIX" },
  { sym: "SOXLUSDT", name: "Semis 3x ETF", ticker: "SOXL" },
  { sym: "SPCXUSDT", name: "SpaceX", ticker: "SPCX" },
  { sym: "DRAMUSDT", name: "DRAM", ticker: "DRAM" },
];

/**
 * Below this absolute gap (bps), treat as near-fair-value noise and skip the LLM
 * (conserves the key). Configurable via LIVE_NOTABLE_BPS; defaults to 40.
 */
const NOTABLE_BPS = Number(process.env.LIVE_NOTABLE_BPS) || 40;

interface LiveVerdict {
  action: "FADE" | "FOLLOW" | "STAND_ASIDE";
  fadeable: boolean;
  multiplier: number;
  rationale: string;
}

interface LiveCall {
  symbol: string;
  ticker: string;
  name: string;
  gapBps: number;
  lastPrice: number;
  indexPrice: number;
  spreadBps: number | null;
  quoteVolumeUSDT: number;
  fundingRate: number | null;
  news: { headline: string; url: string; ts: string | null } | null;
  verdict: LiveVerdict | null;
  verdictNote: string | null;
}

export interface LiveGateStatus {
  state: "live" | "ai_paused" | "degraded" | "retained_previous_good";
  reason: string;
  keyExpiresAt: string | null;
  attempts: number;
  failures: number;
  verdicts: number;
  lastRefreshAttemptAt: string;
  retainedPreviousGood: boolean;
  previousGeneratedAt: string | null;
}

export interface LiveCallsReport {
  generatedAt: string;
  lastRefreshAttemptAt: string;
  gateModel: string;
  notableBps: number;
  gated: boolean;
  gateStatus: LiveGateStatus;
  calls: LiveCall[];
}

function readFlag(name: string, fallback: string): string {
  const idx = process.argv.indexOf(name);
  return idx >= 0 && process.argv[idx + 1] ? process.argv[idx + 1] : fallback;
}

export interface QwenKeyStatus {
  apiKey: string | null;
  state: "available" | "missing" | "expired";
  reason: string;
  expiresAt: string | null;
}

function parseExpiry(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const time = Date.parse(trimmed);
  if (!Number.isFinite(time)) {
    throw new Error("BITGET_QWEN_KEY_EXPIRES_AT must be an ISO timestamp");
  }
  return new Date(time).toISOString();
}

/** Qwen key from env or a chmod-600 key file (mirrors the news pipeline's .finnhubkey pattern). */
export function resolveQwenKeyStatus(
  env = process.env,
  now = new Date(),
): QwenKeyStatus {
  const expiresAt = parseExpiry(env.BITGET_QWEN_KEY_EXPIRES_AT);
  if (expiresAt && Date.parse(expiresAt) <= now.getTime()) {
    return {
      apiKey: null,
      state: "expired",
      reason: `gate key expired at ${expiresAt}`,
      expiresAt,
    };
  }
  const fromEnv = env.BITGET_QWEN_API_KEY?.trim();
  if (fromEnv) {
    return {
      apiKey: fromEnv,
      state: "available",
      reason: "gate key loaded from environment",
      expiresAt,
    };
  }
  const keyFile = env.BITGET_QWEN_API_KEY_FILE?.trim() || ".qwenkey";
  const full = resolve(keyFile);
  if (existsSync(full)) {
    const value = readFileSync(full, "utf8").trim();
    if (value) {
      return {
        apiKey: value,
        state: "available",
        reason: `gate key loaded from ${keyFile}`,
        expiresAt,
      };
    }
  }
  return {
    apiKey: null,
    state: "missing",
    reason: "gate key unavailable",
    expiresAt,
  };
}

function newsFor(
  stockNews: NewsFeedItem[],
  ticker: string,
): NewsFeedItem | null {
  return stockNews.find((n) => (n.symbols || []).includes(ticker)) ?? null;
}

function readPreviousLiveCalls(path: string): LiveCallsReport | null {
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as LiveCallsReport;
    return Array.isArray(parsed.calls) && typeof parsed.generatedAt === "string"
      ? parsed
      : null;
  } catch {
    return null;
  }
}

function liveVerdictCount(report: LiveCallsReport): number {
  return report.calls.filter((call) => call.verdict).length;
}

function reportAgeMs(report: LiveCallsReport, now: Date): number | null {
  const generatedAt = Date.parse(report.generatedAt);
  return Number.isFinite(generatedAt) ? now.getTime() - generatedAt : null;
}

export function chooseLiveCallsReport(
  candidate: LiveCallsReport,
  previous: LiveCallsReport | null,
  options: { now?: Date; maxRetainMs?: number } = {},
): LiveCallsReport {
  if (!previous) return candidate;
  const now = options.now ?? new Date(candidate.lastRefreshAttemptAt);
  const maxRetainMs = options.maxRetainMs ?? 2 * 60 * 60_000;
  const previousAge = reportAgeMs(previous, now);
  const previousVerdicts = liveVerdictCount(previous);
  const candidateVerdicts = liveVerdictCount(candidate);
  const keepPrevious =
    candidate.gated &&
    candidate.gateStatus.attempts > 0 &&
    candidate.gateStatus.failures > 0 &&
    previousAge !== null &&
    previousAge >= 0 &&
    previousAge <= maxRetainMs &&
    previousVerdicts > candidateVerdicts;

  if (!keepPrevious) return candidate;
  return {
    ...previous,
    lastRefreshAttemptAt: candidate.lastRefreshAttemptAt,
    gateStatus: {
      ...candidate.gateStatus,
      state: "retained_previous_good",
      reason: `retained previous live-calls.json with ${previousVerdicts} AI verdicts after degraded refresh produced ${candidateVerdicts}`,
      verdicts: previousVerdicts,
      retainedPreviousGood: true,
      previousGeneratedAt: previous.generatedAt,
    },
  };
}

function writeLiveCallsReport(
  path: string,
  candidate: LiveCallsReport,
): LiveCallsReport {
  const outPath = resolve(path);
  const previous = readPreviousLiveCalls(outPath);
  const maxRetainMs = Number(process.env.LIVE_CALLS_RETAIN_MS || 2 * 60 * 60_000);
  const finalReport = chooseLiveCallsReport(candidate, previous, {
    maxRetainMs,
  });
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(finalReport, null, 2)}\n`);
  return finalReport;
}

export async function buildLiveCalls(): Promise<LiveCallsReport> {
  const newsPath = readFlag("--news", "public/news-feed.json");
  const out = readFlag("--out", "public/live-calls.json");

  const decisionTimestamp = new Date().toISOString();
  const keyStatus = resolveQwenKeyStatus(
    process.env,
    new Date(decisionTimestamp),
  );
  const apiKey = keyStatus.apiKey;
  const qcfg = qwenConfigFromEnv();
  const market = await fetchRwaMarketReport();
  const feed = loadNewsFeed(newsPath);
  const stockNews = feed?.categories?.stock ?? [];

  const calls: LiveCall[] = [];
  let gateAttempts = 0;
  let gateFailures = 0;
  for (const t of TRACKED) {
    const row = market.rows.find((r) => r.symbol === t.sym);
    if (
      !row ||
      row.lastPrice == null ||
      row.indexPrice == null ||
      row.indexPrice <= 0
    ) {
      continue;
    }
    const gap = (row.lastPrice - row.indexPrice) / row.indexPrice;
    const gapBps = Math.round(gap * 10000);
    const item = newsFor(stockNews, t.ticker);
    const base: LiveCall = {
      symbol: t.sym,
      ticker: t.ticker,
      name: t.name,
      gapBps,
      lastPrice: row.lastPrice,
      indexPrice: row.indexPrice,
      spreadBps: row.spreadBps,
      quoteVolumeUSDT: row.quoteVolumeUSDT,
      fundingRate: row.fundingRate,
      news: item
        ? { headline: item.headline, url: item.url, ts: item.ts ?? null }
        : null,
      verdict: null,
      verdictNote: null,
    };

    if (Math.abs(gapBps) < NOTABLE_BPS) {
      base.verdictNote = "near fair value — no gate run";
      calls.push(base);
      continue;
    }
    if (!apiKey) {
      base.verdictNote = keyStatus.reason;
      calls.push(base);
      continue;
    }

    const newsSummary = item
      ? `${item.headline}. ${item.summary ?? ""}`.trim()
      : "No company-specific news found before the decision.";
    const ctx: GateContext = {
      symbol: t.ticker,
      direction: gap > 0 ? "rich" : "cheap",
      dislocationPct: gap,
      sessionLabel: "off-hours",
      newsSummary,
      catalystBundle: feed
        ? buildOperationalCatalystBundle({
            asset: t.ticker,
            newsSummary,
            liveFeed: feed,
            decisionTimestamp,
          })
        : undefined,
    };
    try {
      gateAttempts += 1;
      const verdict = await assessConvergence(ctx, (m) =>
        qwenChat(m, {
          ...qcfg,
          apiKey,
          modelRole: "deep",
          retries: Number(process.env.LIVE_QWEN_RETRIES ?? 2),
          timeoutMs: Number(process.env.LIVE_QWEN_TIMEOUT_MS ?? 30_000),
        }),
      );
      base.verdict = {
        action: verdict.action,
        fadeable: verdict.fadeable,
        multiplier: effectiveMultiplier(verdict),
        rationale: verdict.rationale,
      };
    } catch (err) {
      gateFailures += 1;
      // The hackathon Qwen endpoint times out intermittently — degrade this one
      // symbol to no-verdict rather than failing the whole run.
      base.verdictNote = `gate unavailable: ${err instanceof Error ? err.message.slice(0, 60) : "failed"}`;
    }
    calls.push(base);
  }

  const verdicts = calls.filter((c) => c.verdict).length;
  const gateState: LiveGateStatus["state"] =
    keyStatus.state === "available"
      ? gateFailures > 0
        ? "degraded"
        : "live"
      : "ai_paused";
  const report = writeLiveCallsReport(out, {
    generatedAt: decisionTimestamp,
    lastRefreshAttemptAt: decisionTimestamp,
    gateModel: qcfg.deepModel ?? "qwen3.6-plus",
    notableBps: NOTABLE_BPS,
    gated: Boolean(apiKey),
    gateStatus: {
      state: gateState,
      reason:
        keyStatus.state === "available"
          ? gateFailures > 0
            ? `${gateFailures}/${gateAttempts} gate calls failed`
            : keyStatus.reason
          : keyStatus.reason,
      keyExpiresAt: keyStatus.expiresAt,
      attempts: gateAttempts,
      failures: gateFailures,
      verdicts,
      lastRefreshAttemptAt: decisionTimestamp,
      retainedPreviousGood: false,
      previousGeneratedAt: null,
    },
    calls,
  });
  console.log(
    `live calls: ${out}; ${report.calls.length} markets, ${liveVerdictCount(report)} AI verdicts (gated=${report.gated}, state=${report.gateStatus.state})`,
  );
  return report;
}

if (process.argv[1]?.endsWith("buildLiveCalls.ts")) {
  await buildLiveCalls().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
