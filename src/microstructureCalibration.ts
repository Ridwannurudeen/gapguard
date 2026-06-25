import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

type UnknownRecord = Record<string, unknown>;

export interface CalibrationInputs {
  historicalOutcomeRows: UnknownRecord[];
  currentFeatureRows: UnknownRecord[];
  liveFeatureRows: UnknownRecord[];
  minimumRows?: number;
  generatedAt?: string;
}

export interface CalibrationCoverage {
  historicalOutcomeRows: number;
  currentFeatureRows: number;
  liveFeatureRows: number;
  usableLabeledFeatureRows: number;
  rowsWithSpreadBps: number;
  rowsWithFundingRate: number;
  rowsWithVolume: number;
  rowsWithPremiumDiscountBps: number;
  rowsWithOutcome: number;
  minimumRows: number;
}

export interface MicrostructureCalibrationReport {
  generatedAt: string;
  status: "insufficient_labeled_microstructure_history" | "ready_to_fit";
  coverage: CalibrationCoverage;
  requiredRowShape: string[];
  model: null;
  reliabilityCurve: [];
  decision: string;
  limitations: string[];
  nextDataToCollect: string[];
}

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function readJson(path: string): UnknownRecord {
  return existsSync(path)
    ? asRecord(JSON.parse(readFileSync(path, "utf8")) as unknown)
    : {};
}

function readArray(record: UnknownRecord, key: string): UnknownRecord[] {
  const value = record[key];
  return Array.isArray(value) ? value.map(asRecord) : [];
}

function finiteNumber(record: UnknownRecord, key: string): boolean {
  return typeof record[key] === "number" && Number.isFinite(record[key]);
}

function hasVolume(record: UnknownRecord): boolean {
  return (
    finiteNumber(record, "quoteVolumeUSDT") ||
    finiteNumber(record, "offHoursVolume")
  );
}

function hasOutcome(record: UnknownRecord): boolean {
  return (
    finiteNumber(record, "outcomeReturnPct") ||
    finiteNumber(record, "fadeReturnPct") ||
    finiteNumber(record, "returnPct")
  );
}

function isUsableLabeledFeatureRow(record: UnknownRecord): boolean {
  return (
    typeof record.symbol === "string" &&
    typeof record.decisionTimestamp === "string" &&
    finiteNumber(record, "spreadBps") &&
    finiteNumber(record, "fundingRate") &&
    hasVolume(record) &&
    finiteNumber(record, "premiumDiscountBps") &&
    hasOutcome(record)
  );
}

function flattenMultiBacktestTrades(path: string): UnknownRecord[] {
  const doc = readJson(path);
  return readArray(doc, "symbols").flatMap((symbolReport) =>
    readArray(symbolReport, "trades"),
  );
}

function rowsFromRwaMarket(path: string): UnknownRecord[] {
  return readArray(readJson(path), "rows");
}

function rowsFromLiveCalls(path: string): UnknownRecord[] {
  return readArray(readJson(path), "calls");
}

export function buildMicrostructureCalibrationReport(
  inputs: CalibrationInputs,
): MicrostructureCalibrationReport {
  const minimumRows = inputs.minimumRows ?? 200;
  const allRows = [
    ...inputs.historicalOutcomeRows,
    ...inputs.currentFeatureRows,
    ...inputs.liveFeatureRows,
  ];
  const usableLabeledFeatureRows = allRows.filter(
    isUsableLabeledFeatureRow,
  ).length;
  const coverage: CalibrationCoverage = {
    historicalOutcomeRows: inputs.historicalOutcomeRows.length,
    currentFeatureRows: inputs.currentFeatureRows.length,
    liveFeatureRows: inputs.liveFeatureRows.length,
    usableLabeledFeatureRows,
    rowsWithSpreadBps: allRows.filter((row) => finiteNumber(row, "spreadBps"))
      .length,
    rowsWithFundingRate: allRows.filter((row) => finiteNumber(row, "fundingRate"))
      .length,
    rowsWithVolume: allRows.filter(hasVolume).length,
    rowsWithPremiumDiscountBps: allRows.filter((row) =>
      finiteNumber(row, "premiumDiscountBps"),
    ).length,
    rowsWithOutcome: allRows.filter(hasOutcome).length,
    minimumRows,
  };
  const ready = usableLabeledFeatureRows >= minimumRows;
  return {
    generatedAt: inputs.generatedAt ?? new Date().toISOString(),
    status: ready
      ? "ready_to_fit"
      : "insufficient_labeled_microstructure_history",
    coverage,
    requiredRowShape: [
      "symbol",
      "decisionTimestamp",
      "spreadBps",
      "quoteVolumeUSDT or offHoursVolume",
      "fundingRate",
      "premiumDiscountBps",
      "outcomeReturnPct or fadeReturnPct",
    ],
    model: null,
    reliabilityCurve: [],
    decision: ready
      ? "Feature history is large enough to fit a calibrated probability model in the next step."
      : "Keep deterministic spread/depth/funding/NAV guards as a safety floor; do not claim calibrated fadeable probabilities yet.",
    limitations: [
      "Historical RWA candle fixtures contain outcomes but not point-in-time spread, depth, funding, and NAV premium rows.",
      "Current RWA and live-call snapshots contain microstructure features but do not have realized open-convergence outcome labels.",
      "No reliability curve is published until usable labeled feature rows meet the minimum sample count.",
    ],
    nextDataToCollect: [
      "At every live/off-hours decision, persist symbol, decisionTimestamp, spreadBps, quoteVolumeUSDT/offHoursVolume, fundingRate, premiumDiscountBps, and reference freshness.",
      "After the underlying opens, append the realized fade/follow/stand-aside outcome without mutating the original decision row.",
      "Train and publish a calibration curve only on rows whose features were known at decision time.",
    ],
  };
}

export function loadCalibrationInputs(params: {
  multiBacktestPath?: string;
  rwaMarketPath?: string;
  liveCallsPath?: string;
} = {}): CalibrationInputs {
  return {
    historicalOutcomeRows: flattenMultiBacktestTrades(
      resolve(params.multiBacktestPath ?? "artifacts/rwa-multi-backtest.json"),
    ),
    currentFeatureRows: rowsFromRwaMarket(
      resolve(params.rwaMarketPath ?? "public/rwa-market.json"),
    ),
    liveFeatureRows: rowsFromLiveCalls(
      resolve(params.liveCallsPath ?? "public/live-calls.json"),
    ),
  };
}

export function runMicrostructureCalibrationCli(): void {
  const out = resolve(
    process.argv[2] ?? "artifacts/microstructure-calibration.json",
  );
  const report = buildMicrostructureCalibrationReport(loadCalibrationInputs());
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
  console.log(
    `microstructure calibration: ${report.status}, usable ${report.coverage.usableLabeledFeatureRows}/${report.coverage.minimumRows} labeled rows -> ${out}`,
  );
}

if (process.argv[1]?.endsWith("microstructureCalibration.ts")) {
  runMicrostructureCalibrationCli();
}
