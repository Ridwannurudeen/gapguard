import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export const NEWS_FEED_PATH = "public/news-feed.json";

export interface NewsFeedItem {
  id: string;
  headline: string;
  summary: string;
  source: string;
  url: string;
  ts: string;
  symbols?: string[];
  tags?: string[];
}

export interface EconomicCalendarItem {
  id: string;
  event: string;
  country: string;
  ts: string;
  source: string;
  actual?: string | number | null;
  estimate?: string | number | null;
  prior?: string | number | null;
}

export interface NewsFeedCategories {
  stock: NewsFeedItem[];
  macroPolicy: NewsFeedItem[];
  indexCrossAsset: NewsFeedItem[];
  economicCalendar: EconomicCalendarItem[];
}

export interface NewsFeed {
  generatedAt: string;
  sources: string[];
  notes: string[];
  dropped: Record<keyof NewsFeedCategories, number>;
  categories: NewsFeedCategories;
}

export interface NewsFeedFreshness {
  path: string;
  status: "fresh" | "stale" | "missing" | "invalid";
  generatedAt: string | null;
  ageMinutes: number | null;
  maxAgeMinutes: number;
}

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown, path: string): UnknownRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${path} must be an object`);
  }
  return value as UnknownRecord;
}

function readString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${path} must be a non-empty string`);
  }
  return value;
}

function readIsoTimestamp(value: unknown, path: string): string {
  const timestamp = readString(value, path);
  if (Number.isNaN(Date.parse(timestamp))) {
    throw new Error(`${path} must be a valid ISO timestamp`);
  }
  return timestamp;
}

function optionalValue(
  value: unknown,
  path: string,
): string | number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value === "string" || typeof value === "number") return value;
  throw new Error(`${path} must be string, number, or null`);
}

function readStringArray(value: unknown, path: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${path} must be an array`);
  return value.map((item, index) =>
    readString(item, `${path}[${index}]`),
  );
}

function optionalStringArray(value: unknown, path: string): string[] | undefined {
  if (value === undefined) return undefined;
  return readStringArray(value, path);
}

function readDropped(value: unknown, path: string): Record<keyof NewsFeedCategories, number> {
  const record = asRecord(value, path);
  const readCount = (key: keyof NewsFeedCategories): number => {
    const count = record[key];
    if (typeof count !== "number" || !Number.isInteger(count) || count < 0) {
      throw new Error(`${path}.${key} must be a non-negative integer`);
    }
    return count;
  };
  return {
    stock: readCount("stock"),
    macroPolicy: readCount("macroPolicy"),
    indexCrossAsset: readCount("indexCrossAsset"),
    economicCalendar: readCount("economicCalendar"),
  };
}

function readNewsItem(value: unknown, path: string): NewsFeedItem {
  const record = asRecord(value, path);
  return {
    id: readString(record.id, `${path}.id`),
    headline: readString(record.headline, `${path}.headline`),
    summary: readString(record.summary, `${path}.summary`),
    source: readString(record.source, `${path}.source`),
    url: readString(record.url, `${path}.url`),
    ts: readIsoTimestamp(record.ts, `${path}.ts`),
    symbols: optionalStringArray(record.symbols, `${path}.symbols`),
    tags: optionalStringArray(record.tags, `${path}.tags`),
  };
}

function readCalendarItem(value: unknown, path: string): EconomicCalendarItem {
  const record = asRecord(value, path);
  return {
    id: readString(record.id, `${path}.id`),
    event: readString(record.event, `${path}.event`),
    country: readString(record.country, `${path}.country`),
    ts: readIsoTimestamp(record.ts, `${path}.ts`),
    source: readString(record.source, `${path}.source`),
    actual: optionalValue(record.actual, `${path}.actual`),
    estimate: optionalValue(record.estimate, `${path}.estimate`),
    prior: optionalValue(record.prior, `${path}.prior`),
  };
}

function readArray<T>(
  value: unknown,
  path: string,
  parse: (value: unknown, path: string) => T,
): T[] {
  if (!Array.isArray(value)) throw new Error(`${path} must be an array`);
  return value.map((row, index) => parse(row, `${path}[${index}]`));
}

export function sanitizeNewsText(value: string, maxChars: number): string {
  return value
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxChars);
}

export function parseNewsFeed(value: unknown, path: string): NewsFeed {
  const record = asRecord(value, path);
  const categories = asRecord(record.categories, `${path}.categories`);
  return {
    generatedAt: readIsoTimestamp(record.generatedAt, `${path}.generatedAt`),
    sources: readStringArray(record.sources, `${path}.sources`),
    notes: readStringArray(record.notes, `${path}.notes`),
    dropped: readDropped(record.dropped, `${path}.dropped`),
    categories: {
      stock: readArray(categories.stock, `${path}.categories.stock`, readNewsItem),
      macroPolicy: readArray(
        categories.macroPolicy,
        `${path}.categories.macroPolicy`,
        readNewsItem,
      ),
      indexCrossAsset: readArray(
        categories.indexCrossAsset,
        `${path}.categories.indexCrossAsset`,
        readNewsItem,
      ),
      economicCalendar: readArray(
        categories.economicCalendar,
        `${path}.categories.economicCalendar`,
        readCalendarItem,
      ),
    },
  };
}

export function loadNewsFeed(path = NEWS_FEED_PATH): NewsFeed | null {
  const fullPath = resolve(path);
  if (!existsSync(fullPath)) return null;
  return parseNewsFeed(
    JSON.parse(readFileSync(fullPath, "utf8")) as unknown,
    path,
  );
}

export function assessNewsFeedFreshness(
  path = NEWS_FEED_PATH,
  now = new Date(),
  maxAgeMinutes = 60,
): NewsFeedFreshness {
  const fullPath = resolve(path);
  if (!existsSync(fullPath)) {
    return {
      path,
      status: "missing",
      generatedAt: null,
      ageMinutes: null,
      maxAgeMinutes,
    };
  }

  let feed: NewsFeed;
  try {
    feed = loadNewsFeed(path)!;
  } catch {
    return {
      path,
      status: "invalid",
      generatedAt: null,
      ageMinutes: null,
      maxAgeMinutes,
    };
  }

  const generated = new Date(feed.generatedAt);
  const ageMinutes = (now.getTime() - generated.getTime()) / 60_000;
  return {
    path,
    status: ageMinutes <= maxAgeMinutes ? "fresh" : "stale",
    generatedAt: feed.generatedAt,
    ageMinutes: +ageMinutes.toFixed(1),
    maxAgeMinutes,
  };
}

