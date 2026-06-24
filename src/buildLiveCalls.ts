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

export interface LiveCallsReport {
  generatedAt: string;
  gateModel: string;
  notableBps: number;
  gated: boolean;
  calls: LiveCall[];
}

function readFlag(name: string, fallback: string): string {
  const idx = process.argv.indexOf(name);
  return idx >= 0 && process.argv[idx + 1] ? process.argv[idx + 1] : fallback;
}

/** Qwen key from env or a chmod-600 key file (mirrors the news pipeline's .finnhubkey pattern). */
function loadQwenKey(env = process.env): string | null {
  const fromEnv = env.BITGET_QWEN_API_KEY?.trim();
  if (fromEnv) return fromEnv;
  const keyFile = env.BITGET_QWEN_API_KEY_FILE?.trim() || ".qwenkey";
  const full = resolve(keyFile);
  if (existsSync(full)) {
    const value = readFileSync(full, "utf8").trim();
    if (value) return value;
  }
  return null;
}

function newsFor(
  stockNews: NewsFeedItem[],
  ticker: string,
): NewsFeedItem | null {
  return stockNews.find((n) => (n.symbols || []).includes(ticker)) ?? null;
}

export async function buildLiveCalls(): Promise<LiveCallsReport> {
  const newsPath = readFlag("--news", "public/news-feed.json");
  const out = readFlag("--out", "public/live-calls.json");

  const apiKey = loadQwenKey();
  const qcfg = qwenConfigFromEnv();
  const market = await fetchRwaMarketReport();
  const feed = loadNewsFeed(newsPath);
  const stockNews = feed?.categories?.stock ?? [];
  const decisionTimestamp = new Date().toISOString();

  const calls: LiveCall[] = [];
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
      base.verdictNote = "gate key unavailable";
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
      const verdict = await assessConvergence(ctx, (m) =>
        qwenChat(m, { ...qcfg, apiKey, modelRole: "deep" }),
      );
      base.verdict = {
        action: verdict.action,
        fadeable: verdict.fadeable,
        multiplier: effectiveMultiplier(verdict),
        rationale: verdict.rationale,
      };
    } catch (err) {
      // The hackathon Qwen endpoint times out intermittently — degrade this one
      // symbol to no-verdict rather than failing the whole run.
      base.verdictNote = `gate unavailable: ${err instanceof Error ? err.message.slice(0, 60) : "failed"}`;
    }
    calls.push(base);
  }

  const report: LiveCallsReport = {
    generatedAt: decisionTimestamp,
    gateModel: qcfg.deepModel ?? "qwen3.6-plus",
    notableBps: NOTABLE_BPS,
    gated: Boolean(apiKey),
    calls,
  };
  const outPath = resolve(out);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(
    `live calls: ${out}; ${calls.length} markets, ${calls.filter((c) => c.verdict).length} AI verdicts (gated=${report.gated})`,
  );
  return report;
}

if (process.argv[1]?.endsWith("buildLiveCalls.ts")) {
  await buildLiveCalls().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
