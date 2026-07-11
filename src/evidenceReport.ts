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
    alwaysFadeAccuracyCiPct: string | null;
    alwaysFadeRegretPct: number | null;
    alwaysFadeRegretCiPct: string | null;
    macroAblationAccuracyPct: number | null;
    fullBundleQwenStatus: string;
    fullBundleQwenAccuracyPct: number | null;
    fullBundleQwenAccuracyCiPct: string | null;
    fullBundleQwenRegretPct: number | null;
    fullBundleQwenRegretCiPct: string | null;
    fullBundleQwenRegretReductionCiPct: string | null;
    fullBundleQwenRegretReductionPValue: number | null;
    alwaysFadeTailRegretPct95: number | null;
    fullBundleQwenTailRegretPct95: number | null;
    fullBundleQwenTailRegretReductionCiPct: string | null;
    fullBundleQwenTailRegretReductionPValue: number | null;
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
  liveStockRoundTrip: {
    source: string;
    symbol: string;
    openOrderId: string;
    closeOrderId: string;
    openPrice: number;
    closePrice: number;
    size: number;
    netCostUSDT: number;
    label: string;
  } | null;
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

function formatCi(metric: UnknownRecord): string | null {
  const low = readOptionalNumber(metric, "ciLow");
  const high = readOptionalNumber(metric, "ciHigh");
  return low === null || high === null ? null : `${low}% to ${high}%`;
}

function variantStatCi(
  variant: UnknownRecord,
  key: "accuracyPct" | "meanRegretPct",
): string | null {
  return formatCi(asRecord(asRecord(variant.stats)[key]));
}

function comparisonMetric(
  variant: UnknownRecord,
  key: "meanRegretReductionPct" | "tailRegretReductionPct95",
): UnknownRecord {
  return asRecord(asRecord(variant.comparisonToAlwaysFade)[key]);
}

function normalizeEvidenceText(value: string): string {
  return value.replace(/\r\n/g, "\n");
}

function countJsonlRows(path: string): number {
  const fullPath = resolve(path);
  if (!existsSync(fullPath)) return 0;
  return readFileSync(fullPath, "utf8")
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0).length;
}

function readJsonlRows(path: string): UnknownRecord[] {
  const fullPath = resolve(path);
  if (!existsSync(fullPath)) return [];
  return readFileSync(fullPath, "utf8")
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => asRecord(JSON.parse(line) as unknown));
}

function isFilledLiveOrder(row: UnknownRecord): boolean {
  const receipt = asRecord(row.receipt);
  const side = row.side;
  const size = row.size;
  const timestamp = typeof row.ts === "string" ? Date.parse(row.ts) : NaN;
  return (
    row.mode === "live" &&
    receipt.status === "filled" &&
    typeof row.orderId === "string" &&
    row.orderId.length > 0 &&
    typeof side === "string" &&
    (side === "open_long" ||
      side === "open_short" ||
      side === "close_long" ||
      side === "close_short") &&
    typeof size === "number" &&
    Number.isFinite(size) &&
    size > 0 &&
    Number.isFinite(timestamp)
  );
}

function isMatchingOpen(open: UnknownRecord, close: UnknownRecord): boolean {
  const expectedOpenSide =
    close.side === "close_long" ? "open_long" : "open_short";
  return (
    open.symbol === close.symbol &&
    open.side === expectedOpenSide &&
    open.size === close.size &&
    Date.parse(String(open.ts)) < Date.parse(String(close.ts))
  );
}

/**
 * Pairs only proven filled rows with the same symbol, side, and size. This
 * prevents an unrelated autonomous attempt from being reported as a closed
 * round trip merely because it appears later in the shared journal.
 */
export function buildLiveStockRoundTripFromRows(
  values: unknown[],
): EvidenceReport["liveStockRoundTrip"] {
  const rows = values.map(asRecord).filter(isFilledLiveOrder);
  const close = [...rows]
    .reverse()
    .find((row) => row.side === "close_long" || row.side === "close_short");
  if (!close) return null;
  const open = [...rows].reverse().find((row) => isMatchingOpen(row, close));
  if (!open) return null;
  const openReceipt = asRecord(open.receipt);
  const closeReceipt = asRecord(close.receipt);
  const openPrice =
    readOptionalNumber(openReceipt, "avgFillPrice") ??
    getNumber(open, "referencePrice");
  const closePrice =
    readOptionalNumber(closeReceipt, "avgFillPrice") ??
    getNumber(close, "referencePrice");
  const openDelta = readOptionalNumber(open, "balanceDelta") ?? 0;
  const closeDelta = readOptionalNumber(close, "balanceDelta") ?? 0;
  return {
    source: "artifacts/live-trades.jsonl",
    symbol: getString(open, "symbol"),
    openOrderId: getString(open, "orderId"),
    closeOrderId: getString(close, "orderId"),
    openPrice,
    closePrice,
    size: getNumber(open, "size"),
    netCostUSDT: openDelta + closeDelta,
    label: "real live tokenized-stock fill, opened and closed on-exchange",
  };
}

function buildLiveStockRoundTrip(): EvidenceReport["liveStockRoundTrip"] {
  return buildLiveStockRoundTripFromRows(
    readJsonlRows("artifacts/live-trades.jsonl"),
  );
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

function usd(value: number): string {
  return `${value < 0 ? "-" : "+"}$${Math.abs(value).toFixed(3)}`;
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
| Risk-reduction edge: worst-case (p95) regret, gate vs always-fade | ${report.gateHoldout.fullBundleQwenTailRegretPct95}% vs ${report.gateHoldout.alwaysFadeTailRegretPct95}% (reduction p=${report.gateHoldout.fullBundleQwenTailRegretReductionPValue}) | \`${report.gateHoldout.source}\` |
| Stock paper journal | ${report.stockPaperJournal.rowCount} rows | \`${report.stockPaperJournal.jsonl}\`, \`${report.stockPaperJournal.csv}\` |
| Crypto Demo integration smoke | ${report.cryptoDemoSmoke.rowCount} BTCUSDT paper rows | \`${report.cryptoDemoSmoke.source}\` |${
    report.liveStockRoundTrip
      ? `\n| Live ${report.liveStockRoundTrip.symbol} round-trip (real funds) | open @ ${report.liveStockRoundTrip.openPrice}, close @ ${report.liveStockRoundTrip.closePrice}, size ${report.liveStockRoundTrip.size}, balance ${usd(report.liveStockRoundTrip.netCostUSDT)} | \`${report.liveStockRoundTrip.source}\` |`
      : ""
  }
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
  const alwaysFadeHoldout = holdoutVariant("always_fade");
  const fullBundleQwenHoldout = holdoutVariant("full_bundle_qwen_gate");
  const reportGeneratedAt =
    generatedAt ??
    getString(alpha, "generatedAt") ??
    getString(gate, "generatedAt");

  return {
    generatedAt: reportGeneratedAt,
    productSentence: PRODUCT_SENTENCE,
    boundary:
      "Cryptographic integrity proof, not regulatory certification. Autonomous live execution exists but defaults off and requires VPS-side arming; the evidence set contains one historical live AAPLUSDT round-trip, while strategy results remain backtest/paper evidence.",
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
        alwaysFadeHoldout,
        "accuracyPct",
      ),
      alwaysFadeAccuracyCiPct: variantStatCi(alwaysFadeHoldout, "accuracyPct"),
      alwaysFadeRegretPct: readOptionalNumber(
        alwaysFadeHoldout,
        "meanRegretPct",
      ),
      alwaysFadeRegretCiPct: variantStatCi(alwaysFadeHoldout, "meanRegretPct"),
      macroAblationAccuracyPct: readOptionalNumber(
        holdoutVariant("jobs_fomc_macro_stand_aside"),
        "accuracyPct",
      ),
      fullBundleQwenStatus: getString(fullBundleQwenHoldout, "status"),
      fullBundleQwenAccuracyPct: readOptionalNumber(
        fullBundleQwenHoldout,
        "accuracyPct",
      ),
      fullBundleQwenAccuracyCiPct: variantStatCi(
        fullBundleQwenHoldout,
        "accuracyPct",
      ),
      fullBundleQwenRegretPct: readOptionalNumber(
        fullBundleQwenHoldout,
        "meanRegretPct",
      ),
      fullBundleQwenRegretCiPct: variantStatCi(
        fullBundleQwenHoldout,
        "meanRegretPct",
      ),
      fullBundleQwenRegretReductionCiPct: formatCi(
        comparisonMetric(fullBundleQwenHoldout, "meanRegretReductionPct"),
      ),
      fullBundleQwenRegretReductionPValue: readOptionalNumber(
        asRecord(fullBundleQwenHoldout.comparisonToAlwaysFade),
        "meanRegretReductionPValue",
      ),
      alwaysFadeTailRegretPct95: readOptionalNumber(
        alwaysFadeHoldout,
        "tailRegretPct95",
      ),
      fullBundleQwenTailRegretPct95: readOptionalNumber(
        fullBundleQwenHoldout,
        "tailRegretPct95",
      ),
      fullBundleQwenTailRegretReductionCiPct: formatCi(
        comparisonMetric(fullBundleQwenHoldout, "tailRegretReductionPct95"),
      ),
      fullBundleQwenTailRegretReductionPValue: readOptionalNumber(
        asRecord(fullBundleQwenHoldout.comparisonToAlwaysFade),
        "tailRegretReductionPValue",
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
    liveStockRoundTrip: buildLiveStockRoundTrip(),
    caveats: [
      "The AAPL gate-driven result is n=15 and driven mainly by one correctly avoided WWDC loss.",
      "The 20-symbol always-fade basket is negative, which is why the product is an abstention/risk engine instead of a blind gap fader.",
      "The walk-forward result is a positive pilot OOS over 16 trading days, not proven profitable alpha.",
      "The single live round-trip fill proves the exchange path works end-to-end; it is one small trade, not a live-alpha claim.",
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

Multi-symbol gate holdout: ${report.gateHoldout.holdoutCandidates}/${report.gateHoldout.candidates} candidates across ${report.gateHoldout.symbols} symbols in \`${report.gateHoldout.source}\`. Full-bundle Qwen gate (${report.gateHoldout.fullBundleQwenStatus}): ${report.gateHoldout.fullBundleQwenAccuracyPct}% accuracy (95% CI ${report.gateHoldout.fullBundleQwenAccuracyCiPct ?? "n/a"}) / ${report.gateHoldout.fullBundleQwenRegretPct}% mean regret (95% CI ${report.gateHoldout.fullBundleQwenRegretCiPct ?? "n/a"}) vs always-fade ${report.gateHoldout.alwaysFadeAccuracyPct}% (95% CI ${report.gateHoldout.alwaysFadeAccuracyCiPct ?? "n/a"}) / ${report.gateHoldout.alwaysFadeRegretPct}% (95% CI ${report.gateHoldout.alwaysFadeRegretCiPct ?? "n/a"}). Mean-regret reduction CI vs always-fade: ${report.gateHoldout.fullBundleQwenRegretReductionCiPct ?? "n/a"}; p=${report.gateHoldout.fullBundleQwenRegretReductionPValue ?? "n/a"} (not significant). But worst-case (p95) tail regret falls from ${report.gateHoldout.alwaysFadeTailRegretPct95}% to ${report.gateHoldout.fullBundleQwenTailRegretPct95}% (reduction 95% CI ${report.gateHoldout.fullBundleQwenTailRegretReductionCiPct ?? "n/a"}; p=${report.gateHoldout.fullBundleQwenTailRegretReductionPValue ?? "n/a"}). The gate does not beat always-fade on average accuracy or mean regret; its significance-tested edge is cutting the tail-loss disaster days, reported as risk reduction, not a generalized-alpha claim.

Stock paper journal: \`${report.stockPaperJournal.jsonl}\` and \`${report.stockPaperJournal.csv}\` (${report.stockPaperJournal.rowCount} rows, ${report.stockPaperJournal.label}).

Crypto Demo smoke: \`${report.cryptoDemoSmoke.source}\` (${report.cryptoDemoSmoke.rowCount} rows, ${report.cryptoDemoSmoke.label}).
${
  report.liveStockRoundTrip
    ? `\nLive round-trip: \`${report.liveStockRoundTrip.source}\` — ${report.liveStockRoundTrip.symbol} opened (order \`${report.liveStockRoundTrip.openOrderId}\` @ ${report.liveStockRoundTrip.openPrice}) and closed (order \`${report.liveStockRoundTrip.closeOrderId}\` @ ${report.liveStockRoundTrip.closePrice}), size ${report.liveStockRoundTrip.size}, balance ${usd(report.liveStockRoundTrip.netCostUSDT)} (${report.liveStockRoundTrip.label}).\n`
    : ""
}
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
  if (
    normalizeEvidenceText(currentJson) !== normalizeEvidenceText(expectedJson)
  )
    mismatches.push("public/metrics.json");
  if (
    normalizeEvidenceText(currentMarkdown) !==
    normalizeEvidenceText(expectedMarkdown)
  )
    mismatches.push("docs/METRICS.md");
  for (const path of ["README.md", "docs/SUBMISSION.md"]) {
    const fullPath = resolve(path);
    if (!existsSync(fullPath)) continue;
    const current = readFileSync(fullPath, "utf8");
    const match = current.match(
      /<!-- EVIDENCE:START -->[\s\S]*?<!-- EVIDENCE:END -->/,
    );
    if (
      match &&
      normalizeEvidenceText(match[0]) !== normalizeEvidenceText(expectedBlock)
    )
      mismatches.push(path);
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
