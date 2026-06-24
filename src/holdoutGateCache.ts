import { readFileSync } from "node:fs";
import type { GateAction } from "./convergenceGate";

export interface HoldoutGateVerdict {
  symbol: string;
  date: string;
  action: GateAction;
  multiplier: number;
  evidenceIds: string[];
  rationale: string;
  hasCompanyNews: boolean;
  parseError?: string;
}

export interface HoldoutGateCache {
  generatedAt: string;
  model: string;
  symbols: string[];
  newsSource: string;
  verdicts: HoldoutGateVerdict[];
}

export function holdoutCandidateKey(symbol: string, date: string): string {
  return `${symbol}|${date}`;
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

function readAction(value: unknown, path: string): GateAction {
  if (value === "FADE" || value === "FOLLOW" || value === "STAND_ASIDE") {
    return value;
  }
  throw new Error(`${path} must be FADE, FOLLOW, or STAND_ASIDE`);
}

function readMultiplier(value: unknown, path: string): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > 1
  ) {
    throw new Error(`${path} must be a finite number in [0,1]`);
  }
  return value;
}

function parseVerdict(
  value: unknown,
  path: string,
  index: number,
): HoldoutGateVerdict {
  const row = asRecord(value, `${path}.verdicts[${index}]`);
  return {
    symbol: readString(row.symbol, `${path}.verdicts[${index}].symbol`),
    date: readString(row.date, `${path}.verdicts[${index}].date`),
    action: readAction(row.action, `${path}.verdicts[${index}].action`),
    multiplier: readMultiplier(
      row.multiplier,
      `${path}.verdicts[${index}].multiplier`,
    ),
    evidenceIds: Array.isArray(row.evidenceIds)
      ? row.evidenceIds.filter(
          (id): id is string => typeof id === "string" && id.length > 0,
        )
      : [],
    rationale: typeof row.rationale === "string" ? row.rationale : "",
    hasCompanyNews: row.hasCompanyNews === true,
    parseError: typeof row.parseError === "string" ? row.parseError : undefined,
  };
}

export function parseHoldoutGateCache(
  value: unknown,
  path: string,
): HoldoutGateCache {
  const doc = asRecord(value, path);
  if (!Array.isArray(doc.verdicts)) {
    throw new Error(`${path}.verdicts must be an array`);
  }
  return {
    generatedAt: readString(doc.generatedAt, `${path}.generatedAt`),
    model: readString(doc.model, `${path}.model`),
    symbols: Array.isArray(doc.symbols)
      ? doc.symbols.filter(
          (s): s is string => typeof s === "string" && s.length > 0,
        )
      : [],
    newsSource: readString(doc.newsSource, `${path}.newsSource`),
    verdicts: doc.verdicts.map((row, index) => parseVerdict(row, path, index)),
  };
}

export function loadHoldoutGateCache(path: string): HoldoutGateCache {
  return parseHoldoutGateCache(JSON.parse(readFileSync(path, "utf8")), path);
}

export function holdoutVerdictMap(
  cache: HoldoutGateCache,
): Map<string, GateAction> {
  return new Map(
    cache.verdicts.map((verdict) => [
      holdoutCandidateKey(verdict.symbol, verdict.date),
      verdict.action,
    ]),
  );
}
