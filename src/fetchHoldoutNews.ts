import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { buildHoldoutCandidates } from "./gateHoldoutReport";
import { loadCandleFixture, loadRwaSampleManifest } from "./multiBacktest";

const FINNHUB = "https://finnhub.io/api/v1/company-news";
const DECISION_HOUR = "13:30:00.000Z";
const LOOKBACK_DAYS = 4;

// RWA index proxies whose underlying has no Finnhub company-news symbol.
const NO_COMPANY_NEWS = new Set(["NDX100", "SP500"]);

interface Headline {
  datetime: number;
  headline: string;
  source: string;
}

function underlyingOf(symbol: string): string {
  return symbol.replace(/USDT$/i, "");
}

async function fetchSymbolNews(
  underlying: string,
  from: string,
  to: string,
  token: string,
): Promise<Headline[]> {
  const url = `${FINNHUB}?symbol=${underlying}&from=${from}&to=${to}&token=${token}`;
  const res = await fetch(url);
  if (!res.ok) return [];
  const data = (await res.json()) as unknown;
  if (!Array.isArray(data)) return [];
  return data
    .filter(
      (row): row is { datetime: number; headline: string; source?: string } =>
        Boolean(row) &&
        typeof row === "object" &&
        typeof (row as { datetime?: unknown }).datetime === "number" &&
        typeof (row as { headline?: unknown }).headline === "string",
    )
    .map((row) => ({
      datetime: row.datetime,
      headline: row.headline,
      source: typeof row.source === "string" ? row.source : "Finnhub",
    }));
}

function summaryFor(
  underlying: string,
  date: string,
  headlines: Headline[],
): string {
  const decisionMs = Date.parse(`${date}T${DECISION_HOUR}`);
  const windowStartMs = decisionMs - LOOKBACK_DAYS * 24 * 3600 * 1000;
  const picks = headlines
    .filter(
      (headline) =>
        headline.datetime * 1000 < decisionMs &&
        headline.datetime * 1000 >= windowStartMs,
    )
    .sort((a, b) => b.datetime - a.datetime)
    .slice(0, 6)
    .map(
      (headline) =>
        `- ${new Date(headline.datetime * 1000)
          .toISOString()
          .slice(
            0,
            10,
          )} ${headline.headline.replace(/\s+/g, " ").trim()} (${headline.source})`,
    );
  return picks.length
    ? `${underlying} headlines before the ${date} US open:\n${picks.join("\n")}`
    : `No ${underlying} company-news headlines before the ${date} US open.`;
}

export async function runFetchHoldoutNewsCli(): Promise<void> {
  const token = process.env.FINNHUB_API_KEY;
  if (!token) {
    throw new Error("FINNHUB_API_KEY is required to fetch holdout news");
  }
  const manifestPath = resolve(
    process.argv[2] ?? "data/rwa-sample/manifest.json",
  );
  const out = resolve(process.argv[3] ?? "data/holdout-news-contexts.json");
  const manifest = loadRwaSampleManifest(manifestPath);
  const fixtures = manifest.symbols.map((row) =>
    loadCandleFixture(resolve(row.file)),
  );
  const { holdout } = buildHoldoutCandidates({ fixtures });

  const datesBySymbol = new Map<string, string[]>();
  for (const candidate of holdout) {
    const list = datesBySymbol.get(candidate.symbol) ?? [];
    list.push(candidate.date);
    datesBySymbol.set(candidate.symbol, list);
  }

  const contexts: { symbol: string; date: string; newsSummary: string }[] = [];
  for (const [symbol, dates] of datesBySymbol) {
    const underlying = underlyingOf(symbol);
    const sorted = [...new Set(dates)].sort();
    const from = new Date(
      Date.parse(`${sorted[0]}T00:00:00Z`) - 6 * 24 * 3600 * 1000,
    )
      .toISOString()
      .slice(0, 10);
    const to = sorted.at(-1) ?? sorted[0];
    let headlines: Headline[] = [];
    if (!NO_COMPANY_NEWS.has(underlying)) {
      try {
        headlines = await fetchSymbolNews(underlying, from, to, token);
      } catch {
        headlines = [];
      }
    }
    for (const date of sorted) {
      contexts.push({
        symbol,
        date,
        newsSummary: summaryFor(underlying, date, headlines),
      });
    }
    console.log(
      `  ${symbol} (${underlying}): ${headlines.length} headlines over ${sorted.length} dates`,
    );
  }

  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(
    out,
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        source: "Finnhub /api/v1/company-news",
        contexts,
      },
      null,
      2,
    )}\n`,
  );
  console.log(
    `holdout news: ${contexts.length} contexts across ${datesBySymbol.size} symbols -> ${out}`,
  );
}

if (process.argv[1]?.endsWith("fetchHoldoutNews.ts")) {
  await runFetchHoldoutNewsCli();
}
