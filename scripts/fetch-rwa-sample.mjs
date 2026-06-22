// Fetch a public, no-key RWA candle basket from Bitget for broader backtests.
//
// Usage:
//   node scripts/fetch-rwa-sample.mjs [symbolsCsv] [granularity] [days]
//
// Example:
//   node scripts/fetch-rwa-sample.mjs AAPLUSDT,NVDAUSDT,TSLAUSDT 1H 83

import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const DEFAULT_SYMBOLS = [
  "AAPLUSDT",
  "NVDAUSDT",
  "TSLAUSDT",
  "MSFTUSDT",
  "GOOGLUSDT",
  "AMZNUSDT",
  "METAUSDT",
  "AMDUSDT",
  "COINUSDT",
  "MSTRUSDT",
  "QQQUSDT",
  "SPYUSDT",
  "NDX100USDT",
  "SP500USDT",
  "TSMUSDT",
  "BABAUSDT",
  "NFLXUSDT",
  "PLTRUSDT",
  "AVGOUSDT",
  "ARMUSDT",
];
const PRODUCT_TYPE = "USDT-FUTURES";
const SOURCE = "https://api.bitget.com/api/v2/mix/market/history-candles";
const ROW_LIMIT = 200;

function granularityMs(granularity) {
  const match = granularity.match(/^(\d+)(m|H|D)$/);
  if (!match) {
    throw new Error(`Unsupported granularity ${granularity}`);
  }
  const value = Number(match[1]);
  const unit = match[2];
  if (unit === "m") return value * 60_000;
  if (unit === "H") return value * 3_600_000;
  return value * 86_400_000;
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

async function fetchChunk(symbol, granularity, startTime, endTime) {
  const url = new URL(SOURCE);
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("productType", PRODUCT_TYPE);
  url.searchParams.set("granularity", granularity);
  url.searchParams.set("startTime", String(startTime));
  url.searchParams.set("endTime", String(endTime));
  url.searchParams.set("limit", String(ROW_LIMIT));

  const res = await fetch(url);
  const body = await res.json();
  if (body.code !== "00000" || !Array.isArray(body.data)) {
    throw new Error(`${symbol} fetch failed: ${JSON.stringify(body).slice(0, 300)}`);
  }
  return body.data;
}

async function fetchSymbol(symbol, granularity, days) {
  const step = granularityMs(granularity);
  const end = Date.now();
  const start = end - days * 86_400_000;
  const rows = [];

  for (let chunkStart = start; chunkStart < end; chunkStart += ROW_LIMIT * step) {
    const chunkEnd = Math.min(chunkStart + ROW_LIMIT * step - 1, end);
    rows.push(...(await fetchChunk(symbol, granularity, chunkStart, chunkEnd)));
    await sleep(80);
  }

  const byTs = new Map();
  for (const row of rows) {
    byTs.set(String(row[0]), row);
  }
  return [...byTs.values()]
    .map((r) => ({
      ts: Number(r[0]),
      open: Number(r[1]),
      high: Number(r[2]),
      low: Number(r[3]),
      close: Number(r[4]),
      volume: Number(r[5]),
    }))
    .sort((a, b) => a.ts - b.ts);
}

const symbols = (process.argv[2] ?? DEFAULT_SYMBOLS.join(","))
  .split(",")
  .map((symbol) => symbol.trim().toUpperCase())
  .filter(Boolean);
const granularity = process.argv[3] ?? "1H";
const days = Number(process.argv[4] ?? "83");
if (!Number.isFinite(days) || days <= 0) {
  throw new Error(`Invalid days value ${process.argv[4]}`);
}

const outDir = resolve("data/rwa-sample");
mkdirSync(outDir, { recursive: true });
const manifest = {
  generatedAt: new Date().toISOString(),
  productType: PRODUCT_TYPE,
  source: SOURCE,
  granularity,
  days,
  symbols: [],
};

for (const symbol of symbols) {
  const candles = await fetchSymbol(symbol, granularity, days);
  const file = `data/rwa-sample/${symbol.toLowerCase()}-${granularity.toLowerCase()}.json`;
  writeFileSync(
    resolve(file),
    `${JSON.stringify(
      {
        symbol,
        productType: PRODUCT_TYPE,
        granularity,
        source: SOURCE,
        fetchedAt: manifest.generatedAt,
        count: candles.length,
        candles,
      },
      null,
      0,
    )}\n`,
  );
  manifest.symbols.push({
    symbol,
    file,
    count: candles.length,
    from: candles[0] ? new Date(candles[0].ts).toISOString() : null,
    to: candles.at(-1) ? new Date(candles.at(-1).ts).toISOString() : null,
  });
  console.log(`${symbol}: saved ${candles.length} candles to ${file}`);
}

writeFileSync(
  resolve("data/rwa-sample/manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
);
console.log(`manifest: ${resolve("data/rwa-sample/manifest.json")}`);
