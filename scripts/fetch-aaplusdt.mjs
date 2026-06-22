// Fetch real public Bitget AAPLUSDT (RWA US-stock perp) candles into a committed
// fixture so the backtest is reproducible offline and needs no API key.
// Usage: node scripts/fetch-aaplusdt.mjs [granularity] [limit]
//   default: 1H, 1000 candles. Writes data/aaplusdt-<granularity>.json.

import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const granularity = process.argv[2] ?? "1H";
const limit = process.argv[3] ?? "1000";
const url = `https://api.bitget.com/api/v2/mix/market/candles?symbol=AAPLUSDT&productType=USDT-FUTURES&granularity=${granularity}&limit=${limit}`;

const res = await fetch(url);
const body = await res.json();
if (body.code !== "00000" || !Array.isArray(body.data) || body.data.length === 0) {
  console.error(`fetch failed: ${JSON.stringify(body).slice(0, 300)}`);
  process.exitCode = 1;
} else {
  // Bitget candle row: [ts, open, high, low, close, baseVol, quoteVol]
  const candles = body.data.map((r) => ({
    ts: Number(r[0]),
    open: Number(r[1]),
    high: Number(r[2]),
    low: Number(r[3]),
    close: Number(r[4]),
    volume: Number(r[5]),
  }));
  const out = resolve(`data/aaplusdt-${granularity.toLowerCase()}.json`);
  mkdirSync(resolve("data"), { recursive: true });
  writeFileSync(
    out,
    `${JSON.stringify(
      {
        symbol: "AAPLUSDT",
        productType: "USDT-FUTURES",
        granularity,
        source: "https://api.bitget.com/api/v2/mix/market/candles",
        fetchedAt: new Date().toISOString(),
        count: candles.length,
        candles,
      },
      null,
      0,
    )}\n`,
  );
  const first = new Date(candles[0].ts).toISOString();
  const last = new Date(candles[candles.length - 1].ts).toISOString();
  console.log(`saved ${candles.length} ${granularity} candles (${first} -> ${last}) to ${out}`);
}
