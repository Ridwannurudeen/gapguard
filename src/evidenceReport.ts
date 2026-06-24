import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

type UnknownRecord = Record<string, unknown>;

export const PRODUCT_SENTENCE =
  "GapGuard is an AI abstention and risk engine for tokenized US stocks: it decides whether an off-hours gap is liquidity noise to trade or news-driven repricing to respect, then proves every decision with a signed audit trail.";

export interface MetricSummary {
  source: string;
  window: string;
  costs: string;
  tradeCount: number;
  totalReturnPct: number;
  winRatePct: number;
  profitFactor: number | null;
  label: string;
}

export interface EvidenceReport {
  generatedAt: string;
  productSentence: string;
  boundary: string;
  metrics: {
    aaplAlwaysFade: MetricSummary;
    aaplAlwaysFollow: MetricSummary;
    aaplGateDriven: MetricSummary;
    aaplLabelAware: MetricSummary;
    rwaBasketAlwaysFade: MetricSummary & { symbols: number };
    walkForwardPilot: MetricSummary & {
      alphaStatus: string;
      oosTradingDays: number;
      vsAlwaysFadeReturnPct: number;
    };
  };
  gateAudit: {
    source: string;
    model: string;
    correct: number;
    scored: number;
    accuracyPct: number;
    keyCase: string;
  };
  gateHoldout: {
    source: string;
    symbols: number;
    candidates: number;
    holdoutCandidates: number;
    alwaysFadeAccuracyPct: number | null;
    alwaysFadeRegretPct: number | null;
    macroAblationAccuracyPct: number | null;
    fullBundleQwenStatus: string;
    fullBundleQwenAccuracyPct: number | null;
    fullBundleQwenRegretPct: number | null;
  };
  stockPaperJournal: {
    jsonl: string;
    csv: string;
    rowCount: number;
    label: string;
  };
  cryptoDemoSmoke: {
    source: string;
    rowCount: number;
    label: string;
  };
  caveats: string[];
}

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function readJson(path: string): UnknownRecord {
  return asRecord(JSON.parse(readFileSync(resolve(path), "utf8")) as unknown);
}

function getRecord(record: UnknownRecord, key: string): UnknownRecord {
  const value = asRecord(record[key]);
  if (Object.keys(value).length === 0) {
    throw new Error(`${key} missing or not an object`);
  }
  return value;
}

function getNumber(record: UnknownRecord, key: string): number {
  const value = record[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${key} missing or not a finite number`);
  }
  return value;
}

function getString(record: UnknownRecord, key: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${key} missing or not a string`);
  }
  return value;
}

function getArray(record: UnknownRecord, key: string): unknown[] {
  const value = record[key];
  if (!Array.isArray(value)) {
    throw new Error(`${key} missing or not an array`);
  }
  return value;
}

function readOptionalNumber(record: UnknownRecord, key: string): number | null {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function countJsonlRows(path: string): number {
  const fullPath = resolve(path);
  if (!existsSync(fullPath)) return 0;
  return readFileSync(fullPath, "utf8")
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0).length;
}

function formatWindow(window: UnknownRecord): string {
  return `${String(window.from ?? "unknown")} -> ${String(window.to ?? "unknown")}`;
}

function costLine(params: UnknownRecord): string {
  return `${getNumber(params, "costPerSidePct")}% cost/side + ${getNumber(
    params,
    "slippagePerSideBps",
  )} bps slippage/side`;
}

function metricSummary(params: {
  source: string;
  window: UnknownRecord;
  costs: UnknownRecord;
  metrics: UnknownRecord;
  label: string;
}): MetricSummary {
  return {
    source: params.source,
    window: formatWindow(params.window),
    costs: costLine(params.costs),
    tradeCount: getNumber(params.metrics, "totalTrades"),
    totalReturnPct: getNumber(params.metrics, "totalReturnPct"),
    winRatePct: getNumber(params.metrics, "winRatePct"),
    profitFactor: readOptionalNumber(params.metrics, "profitFactor"),
    label: params.label,
  };
}

function pct(value: number): string {
  return `${value > 0 ? "+" : ""}${value.toFixed(3)}%`;
}

function shortPct(value: number): string {
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function summaryBlock(report: EvidenceReport): string {
  const m = report.metrics;
  return `<!-- EVIDENCE:START -->
| Evidence | Current value | Source |
| --- | ---: | --- |
| AAPLUSDT always-fade baseline | ${pct(m.aaplAlwaysFade.totalReturnPct)} / ${m.aaplAlwaysFade.tradeCount} trades | \`${m.aaplAlwaysFade.source}\` |
| AAPLUSDT always-follow baseline | ${pct(m.aaplAlwaysFollow.totalReturnPct)} / ${m.aaplAlwaysFollow.tradeCount} trades | \`${m.aaplAlwaysFollow.source}\` |
| AAPLUSDT Qwen gate-driven pilot | ${pct(m.aaplGateDriven.totalReturnPct)} / ${m.aaplGateDriven.tradeCount} trades | \`${m.aaplGateDriven.source}\` |
| 20-symbol RWA always-fade baseline | ${pct(m.rwaBasketAlwaysFade.totalReturnPct)} / ${m.rwaBasketAlwaysFade.tradeCount} trades | \`${m.rwaBasketAlwaysFade.source}\` |
| Positive pilot OOS over ${m.walkForwardPilot.oosTradingDays} trading days | ${pct(m.walkForwardPilot.totalReturnPct)} / ${m.walkForwardPilot.tradeCount} trades | \`${m.walkForwardPilot.source}\` |
| Multi-symbol gate holdout | ${report.gateHoldout.holdoutCandidates} holdout candidates / ${report.gateHoldout.symbols} symbols | \`${report.gateHoldout.source}\` |
| Stock paper journal | ${report.stockPaperJournal.rowCount} rows | \`${report.stockPaperJournal.jsonl}\`, \`${report.stockPaperJournal.csv}\` |
| Crypto Demo integration smoke | ${report.cryptoDemoSmoke.rowCount} BTCUSDT paper rows | \`${report.cryptoDemoSmoke.source}\` |
<!-- EVIDENCE:END -->`;
}

function replaceGeneratedBlock(path: string, block: string): void {
  const fullPath = resolve(path);
  if (!existsSync(fullPath)) return;
  const current = readFileSync(fullPath, "utf8");
  const pattern = /<!-- EVIDENCE:START -->[\s\S]*?<!-- EVIDENCE:END -->/;
  if (!pattern.test(current)) return;
  writeFileSync(fullPath, current.replace(pattern, block));
}

export function buildEvidenceReport(generatedAt?: string): EvidenceReport {
  const aapl = readJson("artifacts/aaplusdt-backtest.json");
  const news = readJson("artifacts/aaplusdt-news-aware-backtest.json");
  const multi = readJson("artifacts/rwa-multi-backtest.json");
  const alpha = readJson("artifacts/rwa-alpha-certification.json");
  const gate = readJson("artifacts/aaplusdt-gate-audit.json");
  const holdout = readJson("artifacts/gate-holdout-report.json");
  const newsVariants = getRecord(news, "variants");
  const alphaOos = getRecord(alpha, "outOfSample");
  const alphaRisk = getRecord(alphaOos, "riskAdjusted");
  const alphaPassport = getRecord(alpha, "passportEvidence");
  const holdoutData = getRecord(holdout, "data");
  const holdoutVariants = getArray(holdout, "variants").map(asRecord);
  const holdoutVariant = (name: string) =>
    holdoutVariants.find((variant) => variant.name === name) ?? {};
  const reportGeneratedAt =
    generatedAt ??
    getString(alpha, "generatedAt") ??
    getString(gate, "generatedAt");

  return {
    generatedAt: reportGeneratedAt,
    productSentence: PRODUCT_SENTENCE,
    boundary:
      "Cryptographic integrity proof, not regulatory certification. Approval-gated live path; current stock evidence is backtest/paper.",
    metrics: {
      aaplAlwaysFade: metricSummary({
        source: "artifacts/aaplusdt-backtest.json",
        window: getRecord(aapl, "window"),
        costs: getRecord(aapl, "params"),
        metrics: getRecord(aapl, "metrics"),
        label: "AAPLUSDT always-fade baseline",
      }),
      aaplGateDriven: metricSummary({
        source: "artifacts/aaplusdt-news-aware-backtest.json",
        window: getRecord(news, "window"),
        costs: getRecord(news, "params"),
        metrics: getRecord(newsVariants, "gateDriven"),
        label: "AAPLUSDT Qwen gate-driven pilot",
      }),
      aaplAlwaysFollow: metricSummary({
        source: "artifacts/aaplusdt-news-aware-backtest.json",
        window: getRecord(news, "window"),
        costs: getRecord(news, "params"),
        metrics: getRecord(newsVariants, "alwaysFollow"),
        label: "AAPLUSDT always-follow baseline",
      }),
      aaplLabelAware: metricSummary({
        source: "artifacts/aaplusdt-news-aware-backtest.json",
        window: getRecord(news, "window"),
        costs: getRecord(news, "params"),
        metrics: getRecord(newsVariants, "aaplNewsAware"),
        label: "AAPLUSDT label-aware baseline",
      }),
      rwaBasketAlwaysFade: {
        ...metricSummary({
          source: "artifacts/rwa-multi-backtest.json",
          window: { from: "2026-03-31", to: "2026-06-22" },
          costs: getRecord(multi, "params"),
          metrics: getRecord(multi, "aggregate"),
          label: "20-symbol RWA always-fade baseline",
        }),
        symbols: getNumber(getRecord(multi, "aggregate"), "symbols"),
      },
      walkForwardPilot: {
        ...metricSummary({
          source: "artifacts/rwa-alpha-certification.json",
          window: getRecord(getRecord(alpha, "data"), "window"),
          costs: getRecord(alpha, "protocol"),
          metrics: getRecord(alphaOos, "metrics"),
          label: "positive pilot OOS over 16 trading days",
        }),
        alphaStatus: getString(alphaPassport, "alphaStatus"),
        oosTradingDays: getNumber(alphaRisk, "oosTradingDays"),
        vsAlwaysFadeReturnPct: getNumber(alphaOos, "vsAlwaysFadeReturnPct"),
      },
    },
    gateAudit: {
      source: "artifacts/aaplusdt-gate-audit.json",
      model: getString(gate, "model"),
      correct: getNumber(gate, "correct"),
      scored: getNumber(gate, "scored"),
      accuracyPct: getNumber(gate, "accuracyPct"),
      keyCase:
        "2026-06-09 WWDC: correctly stood aside on a news-driven repricing gap.",
    },
    gateHoldout: {
      source: "artifacts/gate-holdout-report.json",
      symbols: getArray(holdoutData, "symbols").length,
      candidates: getNumber(holdoutData, "candidates"),
      holdoutCandidates: getNumber(holdoutData, "holdoutCandidates"),
      alwaysFadeAccuracyPct: readOptionalNumber(
        holdoutVariant("always_fade"),
        "accuracyPct",
      ),
      alwaysFadeRegretPct: readOptionalNumber(
        holdoutVariant("always_fade"),
        "meanRegretPct",
      ),
      macroAblationAccuracyPct: readOptionalNumber(
        holdoutVariant("jobs_fomc_macro_stand_aside"),
        "accuracyPct",
      ),
      fullBundleQwenStatus: getString(
        holdoutVariant("full_bundle_qwen_gate"),
        "status",
      ),
      fullBundleQwenAccuracyPct: readOptionalNumber(
        holdoutVariant("full_bundle_qwen_gate"),
        "accuracyPct",
      ),
      fullBundleQwenRegretPct: readOptionalNumber(
        holdoutVariant("full_bundle_qwen_gate"),
        "meanRegretPct",
      ),
    },
    stockPaperJournal: {
      jsonl: "artifacts/stock-paper-journal.jsonl",
      csv: "artifacts/stock-paper-journal.csv",
      rowCount: countJsonlRows("artifacts/stock-paper-journal.jsonl"),
      label: "SIMULATED/PAPER_STOCK; not a live exchange stock fill",
    },
    cryptoDemoSmoke: {
      source: "artifacts/paper-btc-smoke.jsonl",
      rowCount: countJsonlRows("artifacts/paper-btc-smoke.jsonl"),
      label:
        "Bitget Demo integration smoke (crypto BTCUSDT), not Track 3 stock evidence",
    },
    caveats: [
      "No live on-exchange RWA stock fill is claimed.",
      "The AAPL gate-driven result is n=15 and driven mainly by one correctly avoided WWDC loss.",
      "The 20-symbol always-fade basket is negative, which is why the product is an abstention/risk engine instead of a blind gap fader.",
      "The walk-forward result is a positive pilot OOS over 16 trading days, not proven profitable alpha.",
    ],
  };
}

export function metricsMarkdown(report: EvidenceReport): string {
  const m = report.metrics;
  return `# GapGuard Metrics

Generated: ${report.generatedAt}

${report.productSentence}

Boundary: ${report.boundary}

| Metric | Return | Trades | Win | PF | Source |
| --- | ---: | ---: | ---: | ---: | --- |
| ${m.aaplAlwaysFade.label} | ${pct(m.aaplAlwaysFade.totalReturnPct)} | ${m.aaplAlwaysFade.tradeCount} | ${shortPct(m.aaplAlwaysFade.winRatePct)} | ${m.aaplAlwaysFade.profitFactor ?? "n/a"} | \`${m.aaplAlwaysFade.source}\` |
| ${m.aaplAlwaysFollow.label} | ${pct(m.aaplAlwaysFollow.totalReturnPct)} | ${m.aaplAlwaysFollow.tradeCount} | ${shortPct(m.aaplAlwaysFollow.winRatePct)} | ${m.aaplAlwaysFollow.profitFactor ?? "n/a"} | \`${m.aaplAlwaysFollow.source}\` |
| ${m.aaplGateDriven.label} | ${pct(m.aaplGateDriven.totalReturnPct)} | ${m.aaplGateDriven.tradeCount} | ${shortPct(m.aaplGateDriven.winRatePct)} | ${m.aaplGateDriven.profitFactor ?? "n/a"} | \`${m.aaplGateDriven.source}\` |
| ${m.aaplLabelAware.label} | ${pct(m.aaplLabelAware.totalReturnPct)} | ${m.aaplLabelAware.tradeCount} | ${shortPct(m.aaplLabelAware.winRatePct)} | ${m.aaplLabelAware.profitFactor ?? "n/a"} | \`${m.aaplLabelAware.source}\` |
| ${m.rwaBasketAlwaysFade.label} | ${pct(m.rwaBasketAlwaysFade.totalReturnPct)} | ${m.rwaBasketAlwaysFade.tradeCount} | ${shortPct(m.rwaBasketAlwaysFade.winRatePct)} | ${m.rwaBasketAlwaysFade.profitFactor ?? "n/a"} | \`${m.rwaBasketAlwaysFade.source}\` |
| ${m.walkForwardPilot.label} | ${pct(m.walkForwardPilot.totalReturnPct)} | ${m.walkForwardPilot.tradeCount} | ${shortPct(m.walkForwardPilot.winRatePct)} | ${m.walkForwardPilot.profitFactor ?? "n/a"} | \`${m.walkForwardPilot.source}\` |

Gate audit: ${report.gateAudit.correct}/${report.gateAudit.scored} (${report.gateAudit.accuracyPct}%) on ${report.gateAudit.source}; ${report.gateAudit.keyCase}

Multi-symbol gate holdout: ${report.gateHoldout.holdoutCandidates}/${report.gateHoldout.candidates} candidates across ${report.gateHoldout.symbols} symbols in \`${report.gateHoldout.source}\`. Full-bundle Qwen gate (${report.gateHoldout.fullBundleQwenStatus}): ${report.gateHoldout.fullBundleQwenAccuracyPct}% accuracy / ${report.gateHoldout.fullBundleQwenRegretPct}% mean regret vs always-fade ${report.gateHoldout.alwaysFadeAccuracyPct}% / ${report.gateHoldout.alwaysFadeRegretPct}%. The gate does not beat always-fade on accuracy but posts lower cost-weighted regret — reported honestly, not as a generalized-edge claim.

Stock paper journal: \`${report.stockPaperJournal.jsonl}\` and \`${report.stockPaperJournal.csv}\` (${report.stockPaperJournal.rowCount} rows, ${report.stockPaperJournal.label}).

Crypto Demo smoke: \`${report.cryptoDemoSmoke.source}\` (${report.cryptoDemoSmoke.rowCount} rows, ${report.cryptoDemoSmoke.label}).

## Caveats

${report.caveats.map((caveat) => `- ${caveat}`).join("\n")}
`;
}

export function writeEvidenceArtifacts(report: EvidenceReport): void {
  mkdirSync(resolve("public"), { recursive: true });
  mkdirSync(resolve("docs"), { recursive: true });
  writeFileSync(
    resolve("public/metrics.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  writeFileSync(resolve("docs/METRICS.md"), metricsMarkdown(report));
  const block = summaryBlock(report);
  replaceGeneratedBlock("README.md", block);
  replaceGeneratedBlock("docs/SUBMISSION.md", block);
}

export function checkEvidenceArtifacts(report: EvidenceReport): void {
  const expectedJson = `${JSON.stringify(report, null, 2)}\n`;
  const expectedMarkdown = metricsMarkdown(report);
  const expectedBlock = summaryBlock(report);
  const currentJson = existsSync(resolve("public/metrics.json"))
    ? readFileSync(resolve("public/metrics.json"), "utf8")
    : "";
  const currentMarkdown = existsSync(resolve("docs/METRICS.md"))
    ? readFileSync(resolve("docs/METRICS.md"), "utf8")
    : "";
  const mismatches: string[] = [];
  if (currentJson !== expectedJson) mismatches.push("public/metrics.json");
  if (currentMarkdown !== expectedMarkdown) mismatches.push("docs/METRICS.md");
  for (const path of ["README.md", "docs/SUBMISSION.md"]) {
    const fullPath = resolve(path);
    if (!existsSync(fullPath)) continue;
    const current = readFileSync(fullPath, "utf8");
    const match = current.match(
      /<!-- EVIDENCE:START -->[\s\S]*?<!-- EVIDENCE:END -->/,
    );
    if (match && match[0] !== expectedBlock) mismatches.push(path);
  }
  if (mismatches.length) {
    throw new Error(`Evidence drift: regenerate ${mismatches.join(", ")}`);
  }
}

export function runEvidenceCli(args: string[]): void {
  const report = buildEvidenceReport();
  if (args.includes("--check")) {
    checkEvidenceArtifacts(report);
    console.log("evidence drift check: OK");
    return;
  }
  writeEvidenceArtifacts(report);
  console.log("evidence artifacts: public/metrics.json, docs/METRICS.md");
}
