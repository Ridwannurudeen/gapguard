import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export interface CommittedMacroEvent {
  id: string;
  date: string;
  timestamp: string;
  event: string;
  country: string;
  text: string;
  actual?: string | number | null;
  estimate?: string | number | null;
  prior?: string | number | null;
}

const DEFAULT_COMMITTED_MACRO_EVENTS: CommittedMacroEvent[] = [
  {
    id: "macro-2026-06-05-jobs",
    date: "2026-06-05",
    timestamp: "2026-06-05T12:30:00.000Z",
    event: "US employment report",
    country: "US",
    text: "US employment report is scheduled before the US equity open; treat same-morning cross-asset moves as macro repricing risk.",
  },
  {
    id: "macro-2026-06-18-fomc",
    date: "2026-06-18",
    timestamp: "2026-06-17T18:00:00.000Z",
    event: "FOMC decision digestion",
    country: "US",
    text: "Prior-session FOMC decision and press-conference digestion can drive broad overnight equity repricing into this open.",
  },
];

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function optionalValue(value: unknown): string | number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value === "string" || typeof value === "number") return value;
  return undefined;
}

function parseEvent(value: unknown): CommittedMacroEvent | null {
  const row = asRecord(value);
  const id = readString(row.id);
  const date = readString(row.date);
  const timestamp = readString(row.timestamp);
  const event = readString(row.event);
  const country = readString(row.country);
  const text = readString(row.text);
  if (!id || !date || !timestamp || !event || !country || !text) return null;
  return {
    id,
    date,
    timestamp,
    event,
    country,
    text,
    actual: optionalValue(row.actual),
    estimate: optionalValue(row.estimate),
    prior: optionalValue(row.prior),
  };
}

export function loadCommittedMacroEvents(
  path = "data/macro-calendar.json",
): CommittedMacroEvent[] {
  const fullPath = resolve(path);
  if (!existsSync(fullPath)) return DEFAULT_COMMITTED_MACRO_EVENTS;
  const doc = asRecord(JSON.parse(readFileSync(fullPath, "utf8")) as unknown);
  const events = Array.isArray(doc.events)
    ? doc.events.map(parseEvent).filter((event): event is CommittedMacroEvent => Boolean(event))
    : [];
  return events.length ? events : DEFAULT_COMMITTED_MACRO_EVENTS;
}

