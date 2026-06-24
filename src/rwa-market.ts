import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fetchTextWithRetry } from "./http";

const BITGET_BASE_URL = "https://api.bitget.com";
const PRODUCT_TYPE = "USDT-FUTURES";
const DEFAULT_LIVE_SYMBOL = "NVDAUSDT";
const DEFAULT_BACKUP_SYMBOL = "SOXLUSDT";
const DEFAULT_MAX_NOTIONAL_USDT = 20;

type UnknownRecord = Record<string, unknown>;

export interface RwaContract {
  symbol: string;
  isRwa: string;
  symbolStatus: string;
  minTradeNum: number;
  minTradeUSDT: number;
  sizeMultiplier: number;
  maxMarketOrderQty: number | null;
  minLever: number | null;
  maxLever: number | null;
}

export interface RwaTicker {
  symbol: string;
  lastPrice: number | null;
  bidPrice: number | null;
  askPrice: number | null;
  markPrice: number | null;
  indexPrice: number | null;
  quoteVolumeUSDT: number;
  holdingAmount: number | null;
  fundingRate: number | null;
  ts: string | null;
}

export interface RwaMarketRow extends RwaContract, RwaTicker {
  spreadBps: number | null;
  suggestedMinSize: number | null;
  suggestedNotionalUSDT: number | null;
  liveReady: boolean;
  blockers: string[];
}

export interface RwaMarketReport {
  generatedAt: string;
  source: {
    baseUrl: string;
    productType: string;
    contracts: string;
    tickers: string;
  };
  defaultLiveSymbol: string;
  backupSymbol: string | null;
  liquidityLeader: string | null;
  selectedLiveSymbol: string | null;
  maxNotionalUSDT: number;
  rows: RwaMarketRow[];
}

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function readRequiredNumber(
  record: UnknownRecord,
  field: string,
  fallback: number,
): number {
  return readNumber(record[field]) ?? fallback;
}

function normalizeContract(value: unknown): RwaContract | null {
  const record = asRecord(value);
  const symbol = readString(record.symbol);
  if (!symbol) return null;

  return {
    symbol,
    isRwa: readString(record.isRwa) ?? "NO",
    symbolStatus: readString(record.symbolStatus) ?? "unknown",
    minTradeNum: readRequiredNumber(record, "minTradeNum", 0),
    minTradeUSDT: readRequiredNumber(record, "minTradeUSDT", 0),
    sizeMultiplier: readRequiredNumber(record, "sizeMultiplier", 0.01),
    maxMarketOrderQty: readNumber(record.maxMarketOrderQty),
    minLever: readNumber(record.minLever),
    maxLever: readNumber(record.maxLever),
  };
}

function normalizeTicker(value: unknown): RwaTicker | null {
  const record = asRecord(value);
  const symbol = readString(record.symbol);
  if (!symbol) return null;

  return {
    symbol,
    lastPrice: readNumber(record.lastPr),
    bidPrice: readNumber(record.bidPr),
    askPrice: readNumber(record.askPr),
    markPrice: readNumber(record.markPrice),
    indexPrice: readNumber(record.indexPrice),
    quoteVolumeUSDT:
      readNumber(record.usdtVolume) ?? readNumber(record.quoteVolume) ?? 0,
    holdingAmount: readNumber(record.holdingAmount),
    fundingRate: readNumber(record.fundingRate),
    ts: readString(record.ts),
  };
}

function spreadBps(bidPrice: number | null, askPrice: number | null) {
  if (
    bidPrice === null ||
    askPrice === null ||
    bidPrice <= 0 ||
    askPrice <= 0
  ) {
    return null;
  }
  const mid = (bidPrice + askPrice) / 2;
  return mid > 0 ? ((askPrice - bidPrice) / mid) * 10_000 : null;
}

function ceilToStep(value: number, step: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (!Number.isFinite(step) || step <= 0) return value;
  return Number((Math.ceil((value - Number.EPSILON) / step) * step).toFixed(8));
}

export function suggestedOrderSize(
  minTradeNum: number,
  minTradeUSDT: number,
  sizeMultiplier: number,
  referencePrice: number | null,
): number | null {
  if (referencePrice === null || referencePrice <= 0) return null;
  const minByNotional = minTradeUSDT > 0 ? minTradeUSDT / referencePrice : 0;
  const step = sizeMultiplier > 0 ? sizeMultiplier : minTradeNum;
  return ceilToStep(Math.max(minTradeNum, minByNotional), step);
}

function rowBlockers(row: {
  isRwa: string;
  symbolStatus: string;
  lastPrice: number | null;
  bidPrice: number | null;
  askPrice: number | null;
  suggestedNotionalUSDT: number | null;
  maxNotionalUSDT: number;
}): string[] {
  const blockers: string[] = [];
  if (row.isRwa !== "YES") blockers.push("not an RWA contract");
  if (row.symbolStatus !== "normal") blockers.push("contract not normal");
  if (row.lastPrice === null) blockers.push("missing last price");
  if (row.bidPrice === null || row.askPrice === null) {
    blockers.push("missing bid/ask");
  }
  if (row.suggestedNotionalUSDT === null) {
    blockers.push("cannot size against minTradeUSDT");
  } else if (row.suggestedNotionalUSDT > row.maxNotionalUSDT) {
    blockers.push("minimum order exceeds live cap");
  }
  return blockers;
}

export function buildRwaMarketReport(
  contracts: RwaContract[],
  tickers: RwaTicker[],
  options: {
    defaultLiveSymbol?: string;
    backupSymbol?: string;
    maxNotionalUSDT?: number;
    generatedAt?: string;
  } = {},
): RwaMarketReport {
  const defaultLiveSymbol = options.defaultLiveSymbol ?? DEFAULT_LIVE_SYMBOL;
  const preferredBackup = options.backupSymbol ?? DEFAULT_BACKUP_SYMBOL;
  const maxNotionalUSDT = options.maxNotionalUSDT ?? DEFAULT_MAX_NOTIONAL_USDT;
  const tickerBySymbol = new Map(
    tickers.map((ticker) => [ticker.symbol, ticker]),
  );

  const rankedRows = contracts
    .filter((contract) => contract.isRwa === "YES")
    .map((contract) => {
      const ticker = tickerBySymbol.get(contract.symbol);
      const emptyTicker: RwaTicker = {
        symbol: contract.symbol,
        lastPrice: null,
        bidPrice: null,
        askPrice: null,
        markPrice: null,
        indexPrice: null,
        quoteVolumeUSDT: 0,
        holdingAmount: null,
        fundingRate: null,
        ts: null,
      };
      const mergedTicker = ticker ?? emptyTicker;
      const suggestedMinSize = suggestedOrderSize(
        contract.minTradeNum,
        contract.minTradeUSDT,
        contract.sizeMultiplier,
        mergedTicker.lastPrice,
      );
      const suggestedNotionalUSDT =
        suggestedMinSize !== null && mergedTicker.lastPrice !== null
          ? suggestedMinSize * mergedTicker.lastPrice
          : null;
      const blockers = rowBlockers({
        isRwa: contract.isRwa,
        symbolStatus: contract.symbolStatus,
        lastPrice: mergedTicker.lastPrice,
        bidPrice: mergedTicker.bidPrice,
        askPrice: mergedTicker.askPrice,
        suggestedNotionalUSDT,
        maxNotionalUSDT,
      });

      return {
        ...contract,
        ...mergedTicker,
        spreadBps: spreadBps(mergedTicker.bidPrice, mergedTicker.askPrice),
        suggestedMinSize,
        suggestedNotionalUSDT,
        liveReady: blockers.length === 0,
        blockers,
      };
    })
    .sort((a, b) => {
      const byVolume = b.quoteVolumeUSDT - a.quoteVolumeUSDT;
      if (byVolume !== 0) return byVolume;
      return (
        (a.spreadBps ?? Number.POSITIVE_INFINITY) -
        (b.spreadBps ?? Number.POSITIVE_INFINITY)
      );
    });

  const liquidityLeader =
    rankedRows.find((row) => row.liveReady) ?? rankedRows[0] ?? null;
  const defaultRow = rankedRows.find((row) => row.symbol === defaultLiveSymbol);
  const backupRow =
    rankedRows.find((row) => row.symbol === preferredBackup) ?? liquidityLeader;
  const selectedLiveSymbol = defaultRow?.liveReady
    ? defaultRow.symbol
    : (liquidityLeader?.symbol ?? null);
  const rows: RwaMarketRow[] = [];
  for (const row of [defaultRow, liquidityLeader, backupRow, ...rankedRows]) {
    if (row && !rows.some((existing) => existing.symbol === row.symbol)) {
      rows.push(row);
    }
    if (rows.length >= 12) break;
  }

  return {
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    source: {
      baseUrl: BITGET_BASE_URL,
      productType: PRODUCT_TYPE,
      contracts: "/api/v2/mix/market/contracts",
      tickers: "/api/v2/mix/market/tickers",
    },
    defaultLiveSymbol,
    backupSymbol: backupRow?.symbol ?? null,
    liquidityLeader: liquidityLeader?.symbol ?? null,
    selectedLiveSymbol,
    maxNotionalUSDT,
    rows,
  };
}

function bitgetUrl(path: string): string {
  const url = new URL(path, BITGET_BASE_URL);
  url.searchParams.set("productType", PRODUCT_TYPE);
  return url.toString();
}

async function fetchBitgetArray(path: string): Promise<unknown[]> {
  const response = await fetchTextWithRetry(bitgetUrl(path), undefined, {
    maxResponseChars: 1_000_000,
  });
  if (!response.ok) {
    throw new Error(`Bitget public API returned HTTP ${response.status}`);
  }
  const payload = asRecord(JSON.parse(response.text) as unknown);
  const code = readString(payload.code);
  if (code && code !== "00000") {
    throw new Error(`Bitget public API returned code ${code}`);
  }
  if (!Array.isArray(payload.data)) {
    throw new Error("Bitget public API response did not include an array");
  }
  return payload.data;
}

export async function fetchRwaMarketReport(): Promise<RwaMarketReport> {
  const [contractValues, tickerValues] = await Promise.all([
    fetchBitgetArray("/api/v2/mix/market/contracts"),
    fetchBitgetArray("/api/v2/mix/market/tickers"),
  ]);
  const contracts = contractValues
    .map(normalizeContract)
    .filter((contract): contract is RwaContract => contract !== null);
  const tickers = tickerValues
    .map(normalizeTicker)
    .filter((ticker): ticker is RwaTicker => ticker !== null);

  return buildRwaMarketReport(contracts, tickers, {
    defaultLiveSymbol: process.env.ARENA_LIVE_SYMBOL ?? DEFAULT_LIVE_SYMBOL,
    backupSymbol: process.env.ARENA_BACKUP_LIVE_SYMBOL ?? DEFAULT_BACKUP_SYMBOL,
    maxNotionalUSDT:
      readNumber(process.env.LIVE_MAX_NOTIONAL_USDT) ??
      DEFAULT_MAX_NOTIONAL_USDT,
  });
}

export async function runRwaMarketCli(): Promise<void> {
  const out = resolve(process.argv[2] ?? "public/rwa-market.json");
  const report = await fetchRwaMarketReport();
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);

  const defaultRow = report.rows.find(
    (row) => row.symbol === report.defaultLiveSymbol,
  );
  const sizeLine = defaultRow
    ? `default ${defaultRow.symbol} size ${defaultRow.suggestedMinSize ?? "n/a"} notional ${defaultRow.suggestedNotionalUSDT?.toFixed(2) ?? "n/a"} USDT`
    : `default ${report.defaultLiveSymbol} missing`;
  console.log(
    `RWA market check: ${out}; ${sizeLine}; liquidity leader ${report.liquidityLeader ?? "n/a"}`,
  );
}

if (process.argv[1]?.endsWith("rwa-market.ts")) {
  await runRwaMarketCli();
}
