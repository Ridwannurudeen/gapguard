import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fetchTextWithRetry } from "./http";
import {
  loadCommittedMacroEvents,
  type CommittedMacroEvent,
} from "./macroCalendar";
import {
  NEWS_FEED_PATH,
  parseNewsFeed,
  sanitizeNewsText,
  type EconomicCalendarItem,
  type NewsFeed,
  type NewsFeedCategories,
  type NewsFeedItem,
} from "./newsFeed";

const FINNHUB_BASE = "https://finnhub.io/api/v1";
const DEFAULT_STOCK_SYMBOLS = ["AAPL", "NVDA", "TSLA", "MSFT"];
const DEFAULT_CAP = 30;
const NEWS_LOOKBACK_DAYS = 3;
const ECONOMIC_LOOKAHEAD_DAYS = 14;

const MACRO_POLICY_KEYWORDS = [
  ["fed", "fed"],
  ["fomc", "fed"],
  ["federal reserve", "fed"],
  ["rate", "rates"],
  ["rates", "rates"],
  ["yield", "rates"],
  ["treasury", "rates"],
  ["inflation", "inflation"],
  ["cpi", "inflation"],
  ["pce", "inflation"],
  ["jobs", "jobs"],
  ["payroll", "jobs"],
  ["employment", "jobs"],
  ["tariff", "tariffs"],
  ["election", "election"],
  ["sec", "regulatory"],
  ["regulator", "regulatory"],
  ["sanction", "sanctions"],
  ["geopolitic", "geopolitics"],
  ["war", "geopolitics"],
] as const;

const INDEX_CROSS_ASSET_KEYWORDS = [
  "s&p",
  "sp500",
  "nasdaq",
  "dow",
  "futures",
  "vix",
  "dollar",
  "dxy",
  "oil",
  "gold",
  "bond",
  "treasury",
  "yield",
  "crypto",
  "bitcoin",
  "equities",
  "stocks",
] as const;

type UnknownRecord = Record<string, unknown>;

interface CategoryResult<T> {
  items: T[];
  dropped: number;
}

interface EconomicCalendarResult {
  items: EconomicCalendarItem[];
  source: string;
  note: string;
}

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function readFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function hashId(prefix: string, parts: string[]): string {
  return `${prefix}-${createHash("sha256")
    .update(parts.join("\n"))
    .digest("hex")
    .slice(0, 16)}`;
}

function dateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number): Date {
  const copy = new Date(date.getTime());
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
}

function endpointUrl(path: string, params: Record<string, string>): string {
  const url = new URL(`${FINNHUB_BASE}${path}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

function endpointLabel(path: string, params: Record<string, string>): string {
  const query = new URLSearchParams(params);
  query.delete("token");
  const suffix = query.toString();
  return suffix ? `Finnhub ${path}?${suffix}` : `Finnhub ${path}`;
}

function loadFinnhubApiKey(env = process.env): string | null {
  const fromEnv = env.FINNHUB_API_KEY?.trim();
  if (fromEnv) return fromEnv;
  const keyFile = env.FINNHUB_API_KEY_FILE?.trim() || ".finnhubkey";
  const fullPath = resolve(keyFile);
  if (!existsSync(fullPath)) return null;
  const value = readFileSync(fullPath, "utf8").trim();
  return value.length ? value : null;
}

function itemKey(item: NewsFeedItem | EconomicCalendarItem): string {
  if ("headline" in item) {
    return `${item.url || "no-url"}|${item.headline.toLowerCase()}`;
  }
  return `${item.event.toLowerCase()}|${item.country}|${item.ts}`;
}

function newestFirst<T extends { ts: string }>(a: T, b: T): number {
  return Date.parse(b.ts) - Date.parse(a.ts);
}

function capNews(
  category: keyof NewsFeedCategories,
  items: NewsFeedItem[],
  cap: number,
): CategoryResult<NewsFeedItem> {
  const seen = new Set<string>();
  const unique: NewsFeedItem[] = [];
  let dropped = 0;
  for (const item of [...items].sort(newestFirst)) {
    const key = itemKey(item);
    if (seen.has(key)) {
      dropped += 1;
      continue;
    }
    seen.add(key);
    unique.push({
      ...item,
      id: hashId(category, [item.ts, item.source, item.headline, item.url]),
    });
  }
  if (unique.length > cap) {
    dropped += unique.length - cap;
  }
  return { items: unique.slice(0, cap), dropped };
}

function capCalendar(
  items: EconomicCalendarItem[],
  cap: number,
): CategoryResult<EconomicCalendarItem> {
  const seen = new Set<string>();
  const unique: EconomicCalendarItem[] = [];
  let dropped = 0;
  for (const item of [...items].sort(newestFirst)) {
    const key = itemKey(item);
    if (seen.has(key)) {
      dropped += 1;
      continue;
    }
    seen.add(key);
    unique.push({
      ...item,
      id: hashId("economicCalendar", [
        item.ts,
        item.country,
        item.event,
        item.source,
      ]),
    });
  }
  if (unique.length > cap) {
    dropped += unique.length - cap;
  }
  return { items: unique.slice(0, cap), dropped };
}

export function macroPolicyTags(item: Pick<NewsFeedItem, "headline" | "summary">): string[] {
  const text = `${item.headline} ${item.summary}`.toLowerCase();
  const tags = new Set<string>();
  for (const [keyword, tag] of MACRO_POLICY_KEYWORDS) {
    if (text.includes(keyword)) tags.add(tag);
  }
  return [...tags].sort();
}

export function isIndexCrossAssetItem(
  item: Pick<NewsFeedItem, "headline" | "summary">,
): boolean {
  const text = `${item.headline} ${item.summary}`.toLowerCase();
  return INDEX_CROSS_ASSET_KEYWORDS.some((keyword) => text.includes(keyword));
}

export function normalizeFinnhubNewsRows(
  value: unknown,
  symbols: string[] = [],
): NewsFeedItem[] {
  if (!Array.isArray(value)) return [];
  const out: NewsFeedItem[] = [];
  for (const raw of value) {
    const row = asRecord(raw);
    const datetime = readFiniteNumber(row.datetime);
    const headline = readString(row.headline);
    const source = readString(row.source) ?? "Finnhub";
    const url = readString(row.url);
    if (datetime === null || !headline || !url) continue;
    const summary = readString(row.summary) ?? headline;
    const related = readString(row.related);
    const itemSymbols = symbols.length
      ? symbols
      : related
        ? related
            .split(",")
            .map((symbol) => symbol.trim())
            .filter(Boolean)
        : undefined;
    out.push({
      id: "pending",
      headline: sanitizeNewsText(headline, 220),
      summary: sanitizeNewsText(summary, 420) || sanitizeNewsText(headline, 220),
      source: sanitizeNewsText(source, 80),
      url: sanitizeNewsText(url, 500),
      ts: new Date(datetime * 1000).toISOString(),
      symbols: itemSymbols,
    });
  }
  return out;
}

function normalizeEconomicCalendarRows(
  value: unknown,
  source: string,
): EconomicCalendarItem[] {
  const rows = Array.isArray(value)
    ? value
    : Array.isArray(asRecord(value).economicCalendar)
      ? (asRecord(value).economicCalendar as unknown[])
      : [];
  const out: EconomicCalendarItem[] = [];
  for (const raw of rows) {
    const row = asRecord(raw);
    const event =
      readString(row.event) ??
      readString(row.name) ??
      readString(row.title) ??
      readString(row.indicator);
    const country =
      readString(row.country) ?? readString(row.region) ?? "unknown";
    const rawTime =
      readString(row.time) ??
      readString(row.datetime) ??
      readString(row.date) ??
      readString(row.period);
    if (!event || !rawTime) continue;
    const ts = /^\d{4}-\d{2}-\d{2}$/.test(rawTime)
      ? `${rawTime}T12:00:00.000Z`
      : new Date(rawTime).toISOString();
    if (Number.isNaN(Date.parse(ts))) continue;
    out.push({
      id: "pending",
      event: sanitizeNewsText(event, 180),
      country: sanitizeNewsText(country, 48),
      ts,
      source,
      actual: row.actual as string | number | null | undefined,
      estimate:
        (row.estimate as string | number | null | undefined) ??
        (row.consensus as string | number | null | undefined),
      prior:
        (row.prior as string | number | null | undefined) ??
        (row.previous as string | number | null | undefined) ??
        (row.prev as string | number | null | undefined),
    });
  }
  return out;
}

function calendarFromCommitted(
  events: CommittedMacroEvent[],
  source = "scheduled calendar (committed)",
): EconomicCalendarItem[] {
  return events.map((event) => ({
    id: event.id,
    event: event.event,
    country: event.country,
    ts: event.timestamp,
    source,
    actual: event.actual,
    estimate: event.estimate,
    prior: event.prior,
  }));
}

export function buildNewsFeed(params: {
  generatedAt: string;
  stockItems: NewsFeedItem[];
  generalItems: NewsFeedItem[];
  economicCalendarItems: EconomicCalendarItem[];
  sources: string[];
  notes: string[];
  cap?: number;
}): NewsFeed {
  const cap = params.cap ?? DEFAULT_CAP;
  const stock = capNews("stock", params.stockItems, cap);
  const macroPolicy = capNews(
    "macroPolicy",
    params.generalItems
      .map((item) => ({ ...item, tags: macroPolicyTags(item) }))
      .filter((item) => item.tags.length > 0),
    cap,
  );
  const indexCrossAsset = capNews(
    "indexCrossAsset",
    params.generalItems.filter(isIndexCrossAssetItem),
    cap,
  );
  const economicCalendar = capCalendar(params.economicCalendarItems, cap);

  return parseNewsFeed(
    {
      generatedAt: params.generatedAt,
      sources: [...new Set(params.sources)],
      notes: params.notes,
      dropped: {
        stock: stock.dropped,
        macroPolicy: macroPolicy.dropped,
        indexCrossAsset: indexCrossAsset.dropped,
        economicCalendar: economicCalendar.dropped,
      },
      categories: {
        stock: stock.items,
        macroPolicy: macroPolicy.items,
        indexCrossAsset: indexCrossAsset.items,
        economicCalendar: economicCalendar.items,
      },
    },
    "news-feed",
  );
}

async function fetchJson(url: string): Promise<{
  ok: boolean;
  status: number;
  text: string;
  json: unknown | null;
}> {
  const response = await fetchTextWithRetry(url, undefined, {
    timeoutMs: 20_000,
    retries: 2,
    maxResponseChars: 1_000_000,
  });
  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      text: response.text,
      json: null,
    };
  }
  return {
    ok: true,
    status: response.status,
    text: response.text,
    json: JSON.parse(response.text) as unknown,
  };
}

async function fetchEconomicCalendar(
  token: string,
  now: Date,
): Promise<EconomicCalendarResult> {
  const source = endpointLabel("/calendar/economic", {
    from: dateOnly(addDays(now, -1)),
    to: dateOnly(addDays(now, ECONOMIC_LOOKAHEAD_DAYS)),
  });
  const url = endpointUrl("/calendar/economic", {
    from: dateOnly(addDays(now, -1)),
    to: dateOnly(addDays(now, ECONOMIC_LOOKAHEAD_DAYS)),
    token,
  });
  const response = await fetchJson(url);
  if (response.ok) {
    return {
      items: normalizeEconomicCalendarRows(response.json, source),
      source,
      note: "Economic calendar fetched from Finnhub. If this endpoint is not available on the deployed key's tier, the fetcher falls back to the committed schedule.",
    };
  }
  if (response.status === 401 || response.status === 403) {
    return {
      items: calendarFromCommitted(loadCommittedMacroEvents()),
      source: "scheduled calendar (committed)",
      note: `Finnhub economic calendar returned HTTP ${response.status}; using scheduled calendar (committed).`,
    };
  }
  return {
    items: calendarFromCommitted(loadCommittedMacroEvents()),
    source: "scheduled calendar (committed)",
    note: `Finnhub economic calendar fetch failed with HTTP ${response.status}; using scheduled calendar (committed).`,
  };
}

function argValue(args: string[], name: string): string | null {
  const index = args.indexOf(name);
  if (index < 0) return null;
  return args[index + 1] ?? null;
}

function symbolsFromEnv(value: string | undefined): string[] {
  const symbols = value
    ?.split(",")
    .map((symbol) => symbol.trim().toUpperCase())
    .filter(Boolean);
  return symbols?.length ? symbols : DEFAULT_STOCK_SYMBOLS;
}

export async function runFetchNewsFeedCli(args = process.argv.slice(2)): Promise<void> {
  const out = resolve(argValue(args, "--out") ?? NEWS_FEED_PATH);
  const now = new Date();
  const generatedAt = now.toISOString();
  const symbolsArg = argValue(args, "--symbols");
  const symbols = symbolsArg
    ? symbolsFromEnv(symbolsArg)
    : symbolsFromEnv(process.env.NEWS_FEED_SYMBOLS);
  const token = loadFinnhubApiKey();
  const allowMissingKey = args.includes("--allow-missing-key");
  const notes = [
    "Macro & Policy is filtered from Finnhub general market news by Fed, rates, inflation, jobs, tariff, election, regulatory, sanctions, and geopolitics keywords; it is not a curated political desk.",
  ];
  const sources: string[] = [];
  const stockItems: NewsFeedItem[] = [];
  let generalItems: NewsFeedItem[] = [];
  let economicCalendar: EconomicCalendarResult = {
    items: calendarFromCommitted(loadCommittedMacroEvents()),
    source: "scheduled calendar (committed)",
    note: "No live economic-calendar request was made.",
  };

  if (!token && !allowMissingKey) {
    throw new Error(
      "FINNHUB_API_KEY or ignored .finnhubkey is required to fetch the live news feed",
    );
  }

  if (token) {
    const from = dateOnly(addDays(now, -NEWS_LOOKBACK_DAYS));
    const to = dateOnly(now);
    for (const symbol of symbols) {
      const source = endpointLabel("/company-news", { symbol, from, to });
      const url = endpointUrl("/company-news", { symbol, from, to, token });
      const response = await fetchJson(url);
      sources.push(source);
      if (response.ok) {
        stockItems.push(...normalizeFinnhubNewsRows(response.json, [symbol]));
      } else {
        notes.push(`${source} returned HTTP ${response.status}; stock category may be incomplete.`);
      }
    }

    const generalSource = endpointLabel("/news", { category: "general" });
    const generalUrl = endpointUrl("/news", {
      category: "general",
      token,
    });
    const generalResponse = await fetchJson(generalUrl);
    sources.push(generalSource);
    if (generalResponse.ok) {
      generalItems = normalizeFinnhubNewsRows(generalResponse.json);
    } else {
      notes.push(`${generalSource} returned HTTP ${generalResponse.status}; macro/policy and index categories may be incomplete.`);
    }

    economicCalendar = await fetchEconomicCalendar(token, now);
    sources.push(economicCalendar.source);
    notes.push(economicCalendar.note);
  } else {
    sources.push("scheduled calendar (committed)");
    notes.push(
      "The live provider was not configured on the refresh host; this file contains the committed calendar fallback only and is not a live news snapshot.",
    );
  }

  const feed = buildNewsFeed({
    generatedAt,
    stockItems,
    generalItems,
    economicCalendarItems: economicCalendar.items,
    sources,
    notes,
  });

  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(feed, null, 2)}\n`);
  parseNewsFeed(JSON.parse(readFileSync(out, "utf8")) as unknown, out);

  console.log(
    `news feed: ${out} stock=${feed.categories.stock.length}, macroPolicy=${feed.categories.macroPolicy.length}, indexCrossAsset=${feed.categories.indexCrossAsset.length}, economicCalendar=${feed.categories.economicCalendar.length}`,
  );
  for (const [category, count] of Object.entries(feed.dropped)) {
    if (count > 0) console.log(`  dropped ${count} ${category} row(s) after dedupe/cap`);
  }
}

if (process.argv[1]?.endsWith("fetchNewsFeed.ts")) {
  await runFetchNewsFeedCli();
}
