import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

type UnknownRecord = Record<string, unknown>;

export type AlphaStatus = "positive" | "negative" | "unproven";

export interface BacktestEvidenceSummary {
  source: string;
  variant: string;
  returnPct: number;
  sharpeAnnualized: number;
  totalTrades: number;
  alphaStatus: AlphaStatus;
  note: string;
}

export interface RwaFreshnessSummary {
  path: string;
  status: "fresh" | "stale" | "missing" | "invalid";
  generatedAt: string | null;
  ageMinutes: number | null;
  maxAgeMinutes: number;
}

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readJson(path: string): unknown | null {
  const fullPath = resolve(path);
  if (!existsSync(fullPath)) return null;
  return JSON.parse(readFileSync(fullPath, "utf8")) as unknown;
}

function alphaStatus(returnPct: number, sharpeAnnualized: number): AlphaStatus {
  return returnPct > 0 && sharpeAnnualized > 0 ? "positive" : "negative";
}

export function loadGateDrivenBacktestEvidence(
  path = "artifacts/aaplusdt-news-aware-backtest.json",
): BacktestEvidenceSummary {
  const report = asRecord(readJson(path));
  const variants = asRecord(report.variants);
  const gateDriven = asRecord(variants.gateDriven);
  const returnPct = readNumber(gateDriven.totalReturnPct);
  const sharpeAnnualized = readNumber(gateDriven.sharpeAnnualized);
  const totalTrades = readNumber(gateDriven.totalTrades);

  if (returnPct === null || sharpeAnnualized === null || totalTrades === null) {
    return {
      source: path,
      variant: "gateDriven",
      returnPct: 0,
      sharpeAnnualized: 0,
      totalTrades: 0,
      alphaStatus: "unproven",
      note: "gate-driven backtest evidence missing; live capital remains disabled",
    };
  }

  const status = alphaStatus(returnPct, sharpeAnnualized);
  return {
    source: path,
    variant: "gateDriven",
    returnPct,
    sharpeAnnualized,
    totalTrades,
    alphaStatus: status,
    note:
      status === "positive"
        ? "gate-driven AI path is positive on the current evidence set"
        : "gate-driven AI path is negative on the current evidence set; passport is safety-only, not proof of alpha",
  };
}

export function loadWalkForwardAlphaEvidence(
  path = "artifacts/rwa-alpha-certification.json",
): BacktestEvidenceSummary | null {
  const report = asRecord(readJson(path));
  const passportEvidence = asRecord(report.passportEvidence);
  const variant = readString(passportEvidence.variant);
  const returnPct = readNumber(passportEvidence.returnPct);
  const sharpeAnnualized = readNumber(passportEvidence.sharpeAnnualized);
  const totalTrades = readNumber(passportEvidence.totalTrades);
  const status = readString(passportEvidence.alphaStatus);
  const note = readString(passportEvidence.note);

  if (
    !variant ||
    returnPct === null ||
    sharpeAnnualized === null ||
    totalTrades === null ||
    (status !== "positive" && status !== "negative" && status !== "unproven")
  ) {
    return null;
  }

  return {
    source: path,
    variant,
    returnPct,
    sharpeAnnualized,
    totalTrades,
    alphaStatus: status,
    note:
      note ??
      "walk-forward RWA pilot artifact loaded; inspect source for details",
  };
}

export function loadBestAlphaEvidence(): BacktestEvidenceSummary {
  return loadWalkForwardAlphaEvidence() ?? loadGateDrivenBacktestEvidence();
}

export function countPaperEvidenceRows(
  paths = ["artifacts/paper-btc-smoke.jsonl", "artifacts/paper-trades.jsonl"],
): number {
  let count = 0;
  for (const path of paths) {
    const fullPath = resolve(path);
    if (!existsSync(fullPath)) continue;
    count += readFileSync(fullPath, "utf8")
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0).length;
  }
  return count;
}

export function assessRwaMarketFreshness(
  path = "public/rwa-market.json",
  now = new Date(),
  maxAgeMinutes = 30,
): RwaFreshnessSummary {
  const report = asRecord(readJson(path));
  const generatedAt = readString(report.generatedAt);
  if (!generatedAt) {
    return {
      path,
      status: existsSync(resolve(path)) ? "invalid" : "missing",
      generatedAt: null,
      ageMinutes: null,
      maxAgeMinutes,
    };
  }

  const generated = new Date(generatedAt);
  if (Number.isNaN(generated.getTime())) {
    return {
      path,
      status: "invalid",
      generatedAt,
      ageMinutes: null,
      maxAgeMinutes,
    };
  }

  const ageMinutes = (now.getTime() - generated.getTime()) / 60_000;
  return {
    path,
    status: ageMinutes <= maxAgeMinutes ? "fresh" : "stale",
    generatedAt,
    ageMinutes: +ageMinutes.toFixed(1),
    maxAgeMinutes,
  };
}
