// Fetch REAL overnight news context per backtest gap date from Finnhub
// company-news, and write data/<asset>-news-contexts.json in the shape the
// convergence-gate audit consumes (gateVerdicts.loadNewsContexts).
//
// This replaces the hand-stubbed blinded summaries with real headlines, so the
// gate is judged on genuine news (de-circularizes the gate audit). The summary
// contains ONLY headlines published strictly BEFORE the session open (no
// look-ahead) and NO fade/stand-aside label.
//
//   FINNHUB_API_KEY=<key> node scripts/fetch-news.mjs [asset] [backtestArtifact]
//   default: AAPLUSDT, artifacts/aaplusdt-backtest.json

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const token = process.env.FINNHUB_API_KEY;
if (!token) {
  console.error("Set FINNHUB_API_KEY in your environment (free Finnhub key).");
  process.exit(1);
}

const asset = process.argv[2] ?? "AAPLUSDT";
const underlying = asset.replace(/USDT$/i, ""); // AAPLUSDT -> AAPL
const btPath = resolve(process.argv[3] ?? "artifacts/aaplusdt-backtest.json");
const trades = JSON.parse(readFileSync(btPath, "utf8")).trades;
const dates = [...new Set(trades.map((t) => t.ts))];

const LOOKBACK_DAYS = 3; // covers a weekend before a Monday session
const MAX_HEADLINES = 6;

function minusDays(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

const contexts = [];
for (const date of dates) {
  const from = minusDays(date, LOOKBACK_DAYS);
  const to = date;
  // Session open ~09:30 ET ≈ 13:30 UTC; only count headlines published before it.
  const openUTC = Date.parse(`${date}T13:30:00Z`);
  const url = `https://finnhub.io/api/v1/company-news?symbol=${underlying}&from=${from}&to=${to}&token=${token}`;

  let summary;
  let headlineCount = 0;
  let appleCount = 0;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      summary = `Finnhub HTTP ${res.status} for ${underlying} ${from}..${to}.`;
    } else {
      const arr = await res.json();
      const inWindow = Array.isArray(arr)
        ? arr.filter((a) => a && a.headline && a.datetime * 1000 < openUTC)
        : [];
      const apple = inWindow.filter((a) => /apple|aapl/i.test(a.headline));
      appleCount = apple.length;
      headlineCount = inWindow.length;
      const picks = (apple.length ? apple : inWindow)
        .sort((a, b) => b.datetime - a.datetime)
        .slice(0, MAX_HEADLINES)
        .map(
          (a) =>
            `- ${new Date(a.datetime * 1000).toISOString().slice(0, 10)} ${a.headline} (${a.source})`,
        );
      summary = picks.length
        ? `${underlying} headlines before the ${date} US open (window ${from}..${date}; ${headlineCount} total, ${appleCount} ${underlying}-specific):\n${picks.join("\n")}`
        : `Finnhub returned no ${underlying} company-news headlines before the ${date} US open (window ${from}..${date}).`;
    }
  } catch (err) {
    summary = `Finnhub fetch failed for ${underlying} ${from}..${to}: ${String(err).slice(0, 120)}`;
  }

  contexts.push({ date, newsSummary: summary, headlineCount, appleCount });
  process.stderr.write(`${date}: ${headlineCount} headlines (${appleCount} ${underlying}-specific)\n`);
  await new Promise((r) => setTimeout(r, 1100)); // gentle on the 60/min free limit
}

const out = resolve(`data/${asset.toLowerCase()}-news-contexts.json`);
mkdirSync(resolve("data"), { recursive: true });
writeFileSync(
  out,
  `${JSON.stringify(
    {
      asset,
      underlying,
      source: "Finnhub /api/v1/company-news",
      lookbackDays: LOOKBACK_DAYS,
      fetchedAt: new Date().toISOString(),
      note: "Real headlines published before each session open; fed (blinded) to the convergence gate. No fade/stand-aside label here.",
      contexts,
    },
    null,
    2,
  )}\n`,
);
const covered = contexts.filter((c) => c.headlineCount > 0).length;
console.log(`\nsaved ${contexts.length} contexts -> ${out}`);
console.log(`coverage: ${covered}/${contexts.length} dates had headlines before the open`);
