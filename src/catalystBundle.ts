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

interface MacroFixture {
  date: string;
  timestamp: string;
  id: string;
  text: string;
}

const SCHEDULED_MACRO: MacroFixture[] = [
  {
    date: "2026-06-05",
    timestamp: "2026-06-05T12:30:00.000Z",
    id: "macro-2026-06-05-jobs",
    text: "US employment report is scheduled before the US equity open; treat same-morning cross-asset moves as macro repricing risk.",
  },
  {
    date: "2026-06-18",
    timestamp: "2026-06-17T18:00:00.000Z",
    id: "macro-2026-06-18-fomc",
    text: "Prior-session FOMC decision and press-conference digestion can drive broad overnight equity repricing into this open.",
  },
];

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
