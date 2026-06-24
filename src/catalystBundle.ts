import { loadCommittedMacroEvents } from "./macroCalendar";
import type { NavReferenceStatus } from "./dislocation";
import type { EconomicCalendarItem, NewsFeed, NewsFeedItem } from "./newsFeed";
import type { OffHoursLiquiditySignal } from "./proxyReturn";

export type CatalystSection =
  | "companyNews"
  | "scheduledMacro"
  | "indexFutures"
  | "crossAsset";

export interface CatalystBundleItem {
  id: string;
  section: CatalystSection;
  timestamp: string;
  source: string;
  text: string;
}

export interface CatalystBundle {
  decisionTimestamp: string;
  companyNews: CatalystBundleItem[];
  scheduledMacro: CatalystBundleItem[];
  indexFutures: CatalystBundleItem[];
  crossAsset: CatalystBundleItem[];
}

export interface OffHoursSignalCatalystInput {
  decisionTimestamp: string;
  premiumDiscountBps?: number;
  reference?: NavReferenceStatus;
  liquidity?: OffHoursLiquiditySignal;
}

const SCHEDULED_MACRO = loadCommittedMacroEvents();

const SECTION_TITLES: Record<CatalystSection, string> = {
  companyNews: "COMPANY_NEWS",
  scheduledMacro: "SCHEDULED_MACRO",
  indexFutures: "INDEX_FUTURES",
  crossAsset: "CROSS_ASSET",
};

function decisionTimestamp(date: string): string {
  return `${date}T13:30:00.000Z`;
}

function preOpenTimestamp(date: string): string {
  return `${date}T12:00:00.000Z`;
}

function isBeforeDecision(timestamp: string, decision: string): boolean {
  return Date.parse(timestamp) < Date.parse(decision);
}

function cleanText(value: string): string {
  return value
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function companyItems(
  asset: string,
  date: string,
  newsSummary: string,
  decision: string,
): CatalystBundleItem[] {
  const items: CatalystBundleItem[] = [];
  const linePattern = /^- (\d{4}-\d{2}-\d{2}) (.+?) \(([^()]+)\)$/gm;
  let match: RegExpExecArray | null;
  let index = 0;
  while ((match = linePattern.exec(newsSummary)) !== null) {
    const timestamp = `${match[1]}T12:00:00.000Z`;
    if (!isBeforeDecision(timestamp, decision)) continue;
    index += 1;
    items.push({
      id: `company-${date}-${index}`,
      section: "companyNews",
      timestamp,
      source: match[3],
      text: cleanText(match[2]),
    });
  }

  if (items.length) return items.slice(0, 8);

  return [
    {
      id: `company-${date}-summary`,
      section: "companyNews",
      timestamp: preOpenTimestamp(date),
      source: "Finnhub company-news summary",
      text: cleanText(`${asset}: ${newsSummary}`).slice(0, 280),
    },
  ];
}

function macroItems(date: string, decision: string): CatalystBundleItem[] {
  const matches = SCHEDULED_MACRO.filter(
    (event) => event.date === date && isBeforeDecision(event.timestamp, decision),
  );
  if (matches.length === 0) {
    return [
      {
        id: `macro-${date}-none`,
        section: "scheduledMacro",
        timestamp: preOpenTimestamp(date),
        source: "committed macro calendar fixture",
        text: "No scheduled CPI, jobs, or FOMC catalyst is recorded for this date in the committed audit fixture.",
      },
    ];
  }
  return matches.map((event) => ({
    id: event.id,
    section: "scheduledMacro",
    timestamp: event.timestamp,
    source: "committed macro calendar fixture",
    text: event.text,
  }));
}

function indexFuturesItems(date: string, decision: string): CatalystBundleItem[] {
  const hasMacro = SCHEDULED_MACRO.some((event) => event.date === date);
  const timestamp = preOpenTimestamp(date);
  if (!isBeforeDecision(timestamp, decision)) return [];
  return [
    {
      id: `index-futures-${date}`,
      section: "indexFutures",
      timestamp,
      source: "committed pre-open futures context",
      text: hasMacro
        ? "Broad index-futures context should be treated as event-linked until a live futures feed confirms otherwise."
        : "No committed pre-open S&P/Nasdaq futures shock is recorded for this date; do not infer a broad-market catalyst from this section alone.",
    },
  ];
}

function crossAssetItems(date: string, decision: string): CatalystBundleItem[] {
  const hasMacro = SCHEDULED_MACRO.some((event) => event.date === date);
  const timestamp = preOpenTimestamp(date);
  if (!isBeforeDecision(timestamp, decision)) return [];
  return [
    {
      id: `cross-asset-${date}`,
      section: "crossAsset",
      timestamp,
      source: "committed cross-asset context",
      text: hasMacro
        ? "DXY/VIX/rates context is flagged as macro-sensitive for this open; stand aside unless company evidence clearly dominates."
        : "No committed DXY, VIX, or rates shock is recorded for this date; cross-asset context is neutral.",
    },
  ];
}

function duration(ms: number | null): string {
  if (ms === null) return "n/a";
  const minutes = ms / 60_000;
  return minutes < 120
    ? `${minutes.toFixed(1)}m`
    : `${(minutes / 60).toFixed(1)}h`;
}

function bps(value: number | undefined): string {
  return value === undefined ? "n/a" : value.toFixed(1);
}

function numberOrNa(value: number | null, digits: number): string {
  return value === null ? "n/a" : value.toFixed(digits);
}

function assertSignalTimestamp(
  timestamp: string,
  decision: string,
  label: string,
): void {
  if (!isBeforeDecision(timestamp, decision)) {
    throw new Error(
      `${label} timestamp ${timestamp} is not before decision ${decision}`,
    );
  }
}

export function buildOffHoursSignalItems(
  input: OffHoursSignalCatalystInput,
): CatalystBundleItem[] {
  const items: CatalystBundleItem[] = [];
  if (input.reference?.asOf) {
    assertSignalTimestamp(
      input.reference.asOf,
      input.decisionTimestamp,
      "NAV/oracle reference",
    );
    items.push({
      id: `nav-oracle-${input.reference.asOf.slice(0, 10)}`,
      section: "crossAsset",
      timestamp: input.reference.asOf,
      source: input.reference.source,
      text: cleanText(
        [
          `NAV_ORACLE premiumDiscountBps=${bps(input.premiumDiscountBps)}`,
          `price=${input.reference.price}`,
          `freshness=${input.reference.stale ? "stale" : "fresh"}`,
          `age=${duration(input.reference.ageMs)}`,
          `maxAge=${duration(input.reference.maxAgeMs)}`,
          input.reference.fallback ? "fallback=labeled" : "fallback=false",
          input.reference.label,
        ].join("; "),
      ),
    });
  }

  if (input.liquidity) {
    assertSignalTimestamp(
      input.liquidity.asOf,
      input.decisionTimestamp,
      "off-hours liquidity",
    );
    items.push({
      id: `off-hours-liquidity-${input.liquidity.asOf.slice(0, 10)}`,
      section: "crossAsset",
      timestamp: input.liquidity.asOf,
      source: input.liquidity.source,
      text: cleanText(
        [
          `OFF_HOURS_LIQUIDITY depth=${input.liquidity.depth}`,
          `gateBias=${input.liquidity.gateBias}`,
          `spreadBps=${numberOrNa(input.liquidity.spreadBps, 1)}`,
          `offHoursVolume=${input.liquidity.offHoursVolume.toFixed(2)}`,
          `volumeRatio=${numberOrNa(input.liquidity.volumeRatio, 2)}`,
          input.liquidity.fallback ? "fallback=labeled" : "fallback=false",
          input.liquidity.reason,
        ].join("; "),
      ),
    });
  }

  return items;
}

function underlyingOf(asset: string): string {
  return asset.replace(/USDT$/i, "").replace(/X$/i, "").toUpperCase();
}

function itemText(headline: string, summary: string): string {
  const summaryText = cleanText(summary);
  const headlineText = cleanText(headline);
  if (!summaryText || summaryText === headlineText) return headlineText;
  return `${headlineText} - ${summaryText}`.slice(0, 360);
}

function toNewsCatalystItems(
  section: CatalystSection,
  items: NewsFeedItem[],
  decision: string,
  maxItems: number,
): CatalystBundleItem[] {
  return items
    .filter((item) => isBeforeDecision(item.ts, decision))
    .slice(0, maxItems)
    .map((item) => ({
      id: item.id,
      section,
      timestamp: item.ts,
      source: item.source,
      text: itemText(item.headline, item.summary),
    }));
}

function toCalendarCatalystItems(
  items: EconomicCalendarItem[],
  decision: string,
  maxItems: number,
): CatalystBundleItem[] {
  return items
    .filter((item) => isBeforeDecision(item.ts, decision))
    .slice(0, maxItems)
    .map((item) => {
      const values = [
        item.actual === undefined ? "" : `actual=${item.actual ?? "n/a"}`,
        item.estimate === undefined ? "" : `estimate=${item.estimate ?? "n/a"}`,
        item.prior === undefined ? "" : `prior=${item.prior ?? "n/a"}`,
      ].filter(Boolean);
      return {
        id: item.id,
        section: "scheduledMacro" as const,
        timestamp: item.ts,
        source: item.source,
        text: cleanText(
          `${item.country} ${item.event}${values.length ? ` (${values.join(", ")})` : ""}`,
        ),
      };
    });
}

export function buildCatalystBundle(input: {
  asset: string;
  date: string;
  newsSummary: string;
  decisionTimestamp?: string;
}): CatalystBundle {
  const decision = input.decisionTimestamp ?? decisionTimestamp(input.date);
  return {
    decisionTimestamp: decision,
    companyNews: companyItems(
      input.asset,
      input.date,
      input.newsSummary,
      decision,
    ),
    scheduledMacro: macroItems(input.date, decision),
    indexFutures: indexFuturesItems(input.date, decision),
    crossAsset: crossAssetItems(input.date, decision),
  };
}

export function buildOperationalCatalystBundle(input: {
  asset: string;
  newsSummary: string;
  liveFeed: NewsFeed;
  decisionTimestamp?: string;
  maxItemsPerSection?: number;
}): CatalystBundle {
  const decision = input.decisionTimestamp ?? new Date().toISOString();
  const date = decision.slice(0, 10);
  const maxItems = input.maxItemsPerSection ?? 8;
  const underlying = underlyingOf(input.asset);
  const matchingStock = input.liveFeed.categories.stock.filter(
    (item) =>
      !item.symbols?.length ||
      item.symbols.some((symbol) => symbol.toUpperCase() === underlying),
  );
  const bundle = {
    decisionTimestamp: decision,
    companyNews: matchingStock.length
      ? toNewsCatalystItems("companyNews", matchingStock, decision, maxItems)
      : companyItems(input.asset, date, input.newsSummary, decision),
    scheduledMacro: toCalendarCatalystItems(
      input.liveFeed.categories.economicCalendar,
      decision,
      maxItems,
    ),
    indexFutures: toNewsCatalystItems(
      "indexFutures",
      input.liveFeed.categories.indexCrossAsset,
      decision,
      maxItems,
    ),
    crossAsset: toNewsCatalystItems(
      "crossAsset",
      input.liveFeed.categories.macroPolicy,
      decision,
      maxItems,
    ),
  };
  validateNoLookAhead(bundle);
  return bundle;
}

export function allCatalystItems(bundle: CatalystBundle): CatalystBundleItem[] {
  return [
    ...bundle.companyNews,
    ...bundle.scheduledMacro,
    ...bundle.indexFutures,
    ...bundle.crossAsset,
  ];
}

export function validateNoLookAhead(bundle: CatalystBundle): void {
  for (const item of allCatalystItems(bundle)) {
    if (!isBeforeDecision(item.timestamp, bundle.decisionTimestamp)) {
      throw new Error(
        `catalyst item ${item.id} timestamp ${item.timestamp} is not before decision ${bundle.decisionTimestamp}`,
      );
    }
  }
}

export function formatCatalystBundle(bundle: CatalystBundle): string {
  validateNoLookAhead(bundle);
  const section = (name: CatalystSection, items: CatalystBundleItem[]) =>
    [
      `${SECTION_TITLES[name]}:`,
      ...items.map(
        (item) =>
          `[${item.id}] ${item.timestamp} ${item.source}: ${cleanText(item.text)}`,
      ),
    ].join("\n");
  return [
    `DECISION_TS: ${bundle.decisionTimestamp}`,
    section("companyNews", bundle.companyNews),
    section("scheduledMacro", bundle.scheduledMacro),
    section("indexFutures", bundle.indexFutures),
    section("crossAsset", bundle.crossAsset),
  ].join("\n\n");
}

function asRecord(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${path} must be an object`);
  }
  return value as Record<string, unknown>;
}

function readString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${path} must be a non-empty string`);
  }
  return value;
}

function readSection(value: unknown, path: string): CatalystBundleItem[] {
  if (!Array.isArray(value)) throw new Error(`${path} must be an array`);
  return value.map((row, index) => {
    const item = asRecord(row, `${path}[${index}]`);
    const section = readString(item.section, `${path}[${index}].section`);
    if (
      section !== "companyNews" &&
      section !== "scheduledMacro" &&
      section !== "indexFutures" &&
      section !== "crossAsset"
    ) {
      throw new Error(`${path}[${index}].section is invalid`);
    }
    return {
      id: readString(item.id, `${path}[${index}].id`),
      section,
      timestamp: readString(item.timestamp, `${path}[${index}].timestamp`),
      source: readString(item.source, `${path}[${index}].source`),
      text: readString(item.text, `${path}[${index}].text`),
    };
  });
}

export function parseCatalystBundle(value: unknown, path: string): CatalystBundle {
  const record = asRecord(value, path);
  const bundle = {
    decisionTimestamp: readString(
      record.decisionTimestamp,
      `${path}.decisionTimestamp`,
    ),
    companyNews: readSection(record.companyNews, `${path}.companyNews`),
    scheduledMacro: readSection(
      record.scheduledMacro,
      `${path}.scheduledMacro`,
    ),
    indexFutures: readSection(record.indexFutures, `${path}.indexFutures`),
    crossAsset: readSection(record.crossAsset, `${path}.crossAsset`),
  };
  validateNoLookAhead(bundle);
  return bundle;
}
