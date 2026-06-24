import { readFileSync } from "node:fs";
import {
  buildCatalystBundle,
  parseCatalystBundle,
  type CatalystBundle,
} from "./catalystBundle";
import type { GateAction, GateContext } from "./convergenceGate";

export interface GateBacktestTrade {
  ts: string;
  direction: "long" | "short";
  gapPct: number;
  returnPct: number;
}

export interface NewsContextRecord {
  date: string;
  newsSummary: string;
  catalystBundle?: CatalystBundle;
}

export interface GateLabelRecord {
  date: string;
  expectedFadeable: boolean;
  expectedAction?: GateAction;
  labelRationale: string;
}

export interface GateVerdictRecord {
  date: string;
  newsSummary?: string;
  action: GateAction;
  fadeable: boolean;
  multiplier: number;
  evidenceIds: string[];
  catalystBundle?: CatalystBundle;
  expectedFadeable?: boolean;
  expectedAction?: GateAction;
  correct?: boolean;
  returnPct: number;
  rationale: string;
  labelRationale?: string;
  parseError?: string;
}

export interface GateVerdictCache {
  asset: string;
  model: string;
  generatedAt?: string;
  promptSource?: string;
  contextsSource?: string;
  labelsSource?: string;
  verdicts: GateVerdictRecord[];
}

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown, path: string, field: string): UnknownRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${path}: ${field} must be an object`);
  }
  return value as UnknownRecord;
}

function readArray(value: unknown, path: string, field: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`${path}: ${field} must be an array`);
  }
  return value;
}

function readString(value: unknown, path: string, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${path}: ${field} must be a non-empty string`);
  }
  return value;
}

function optionalString(
  value: unknown,
  path: string,
  field: string,
): string | undefined {
  if (value === undefined) return undefined;
  return readString(value, path, field);
}

function optionalBoolean(
  value: unknown,
  path: string,
  field: string,
): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") {
    throw new Error(`${path}: ${field} must be a boolean`);
  }
  return value;
}

function optionalGateAction(
  value: unknown,
  path: string,
  field: string,
): GateAction | undefined {
  if (value === undefined) return undefined;
  return readGateAction(value, path, field);
}

function readGateAction(value: unknown, path: string, field: string): GateAction {
  if (value === "FADE" || value === "FOLLOW" || value === "STAND_ASIDE") {
    return value;
  }
  throw new Error(`${path}: ${field} must be FADE, FOLLOW, or STAND_ASIDE`);
}

function readBoolean(value: unknown, path: string, field: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`${path}: ${field} must be a boolean`);
  }
  return value;
}

function readFiniteNumber(value: unknown, path: string, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${path}: ${field} must be a finite number`);
  }
  return value;
}

function readMultiplier(value: unknown, path: string, field: string): number {
  const multiplier = readFiniteNumber(value, path, field);
  if (multiplier < 0 || multiplier > 1) {
    throw new Error(`${path}: ${field} must be between 0 and 1`);
  }
  return multiplier;
}

function parseNewsContext(
  value: unknown,
  path: string,
  index: number,
  asset: string,
): NewsContextRecord {
  const row = asRecord(value, path, `contexts[${index}]`);
  const date = readString(row.date, path, `contexts[${index}].date`);
  const newsSummary = readString(
    row.newsSummary,
    path,
    `contexts[${index}].newsSummary`,
  );
  return {
    date,
    newsSummary,
    catalystBundle:
      row.catalystBundle === undefined
        ? buildCatalystBundle({ asset, date, newsSummary })
        : parseCatalystBundle(
            row.catalystBundle,
            `${path}: contexts[${index}].catalystBundle`,
          ),
  };
}

function parseGateLabel(
  value: unknown,
  path: string,
  index: number,
): GateLabelRecord {
  const row = asRecord(value, path, `labels[${index}]`);
  return {
    date: readString(row.date, path, `labels[${index}].date`),
    expectedFadeable: readBoolean(
      row.expectedFadeable,
      path,
      `labels[${index}].expectedFadeable`,
    ),
    expectedAction: optionalGateAction(
      row.expectedAction,
      path,
      `labels[${index}].expectedAction`,
    ),
    labelRationale: readString(
      row.labelRationale,
      path,
      `labels[${index}].labelRationale`,
    ),
  };
}

function parseGateVerdict(
  value: unknown,
  path: string,
  index: number,
): GateVerdictRecord {
  const row = asRecord(value, path, `verdicts[${index}]`);
  const action = optionalGateAction(
    row.action,
    path,
    `verdicts[${index}].action`,
  );
  const fadeable = readBoolean(
    row.fadeable,
    path,
    `verdicts[${index}].fadeable`,
  );
  return {
    date: readString(row.date, path, `verdicts[${index}].date`),
    newsSummary: optionalString(
      row.newsSummary,
      path,
      `verdicts[${index}].newsSummary`,
    ),
    action: action ?? (fadeable ? "FADE" : "STAND_ASIDE"),
    fadeable,
    multiplier: readMultiplier(
      row.multiplier,
      path,
      `verdicts[${index}].multiplier`,
    ),
    evidenceIds: Array.isArray(row.evidenceIds)
      ? row.evidenceIds.map((evidenceId, evidenceIndex) =>
          readString(
            evidenceId,
            path,
            `verdicts[${index}].evidenceIds[${evidenceIndex}]`,
          ),
        )
      : [],
    expectedFadeable: optionalBoolean(
      row.expectedFadeable,
      path,
      `verdicts[${index}].expectedFadeable`,
    ),
    expectedAction: optionalGateAction(
      row.expectedAction,
      path,
      `verdicts[${index}].expectedAction`,
    ),
    correct: optionalBoolean(row.correct, path, `verdicts[${index}].correct`),
    returnPct: readFiniteNumber(
      row.returnPct,
      path,
      `verdicts[${index}].returnPct`,
    ),
    rationale: readString(row.rationale, path, `verdicts[${index}].rationale`),
    labelRationale: optionalString(
      row.labelRationale,
      path,
      `verdicts[${index}].labelRationale`,
    ),
    parseError: optionalString(
      row.parseError,
      path,
      `verdicts[${index}].parseError`,
    ),
  };
}

export function loadNewsContexts(path: string): Map<string, NewsContextRecord> {
  const doc = asRecord(JSON.parse(readFileSync(path, "utf8")) as unknown, path, "$");
  const asset = optionalString(doc.asset, path, "asset") ?? "UNKNOWN";
  const contexts = readArray(doc.contexts, path, "contexts").map(
    (row, index) => parseNewsContext(row, path, index, asset),
  );
  return new Map(contexts.map((c) => [c.date, c]));
}

export function loadGateLabels(path: string): Map<string, GateLabelRecord> {
  const doc = asRecord(JSON.parse(readFileSync(path, "utf8")) as unknown, path, "$");
  const labels = readArray(doc.labels, path, "labels").map((row, index) =>
    parseGateLabel(row, path, index),
  );
  return new Map(labels.map((l) => [l.date, l]));
}

export function loadGateVerdicts(path: string): GateVerdictCache {
  const doc = asRecord(JSON.parse(readFileSync(path, "utf8")) as unknown, path, "$");
  const rawVerdicts =
    "verdicts" in doc ? doc.verdicts : (doc.results as unknown);
  return {
    asset: readString(doc.asset, path, "asset"),
    model: readString(doc.model, path, "model"),
    generatedAt: optionalString(doc.generatedAt, path, "generatedAt"),
    promptSource: optionalString(doc.promptSource, path, "promptSource"),
    contextsSource: optionalString(doc.contextsSource, path, "contextsSource"),
    labelsSource: optionalString(doc.labelsSource, path, "labelsSource"),
    verdicts: readArray(rawVerdicts, path, "verdicts").map((row, index) =>
      parseGateVerdict(row, path, index),
    ),
  };
}

export function buildGateContextFromTrade(
  asset: string,
  trade: GateBacktestTrade,
  newsSummary: string,
  catalystBundle?: CatalystBundle,
): GateContext {
  return {
    symbol: asset,
    direction: trade.direction === "short" ? "rich" : "cheap",
    dislocationPct: trade.gapPct / 100,
    sessionLabel: "overnight (US stock off-hours)",
    newsSummary,
    catalystBundle,
  };
}

export function gateStandAsideDates(cache: GateVerdictCache): Set<string> {
  return new Set(
    cache.verdicts
      .filter((v) => v.action === "STAND_ASIDE")
      .map((v) => v.date),
  );
}

export function summarizeGateAccuracy(verdicts: GateVerdictRecord[]): {
  correct: number;
  total: number;
  accuracyPct: number;
} {
  const scored = verdicts.filter((v) =>
    v.expectedAction
      ? v.action === v.expectedAction
      : typeof v.expectedFadeable === "boolean" &&
        typeof v.correct === "boolean",
  );
  const correct = scored.filter((v) =>
    v.expectedAction ? v.action === v.expectedAction : v.correct,
  ).length;
  return {
    correct,
    total: scored.length,
    accuracyPct: scored.length ? (correct / scored.length) * 100 : 0,
  };
}
