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
import { fetchTextWithRetry } from "./http.mjs";

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
const MACRO_EVENTS = new Map([
  [
    "2026-06-05",
    {
      id: "macro-2026-06-05-jobs",
      timestamp: "2026-06-05T12:30:00.000Z",
      text: "US employment report is scheduled before the US equity open; treat same-morning cross-asset moves as macro repricing risk.",
    },
  ],
  [
    "2026-06-18",
    {
      id: "macro-2026-06-18-fomc",
      timestamp: "2026-06-17T18:00:00.000Z",
      text: "Prior-session FOMC decision and press-conference digestion can drive broad overnight equity repricing into this open.",
    },
  ],
]);

function minusDays(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

function catalystBundleFor(date, summary) {
  const decisionTimestamp = `${date}T13:30:00.000Z`;
  const companyNews = summary
    .split("\n")
    .filter((line) => line.startsWith("- "))
    .slice(0, 8)
    .map((line, index) => ({
      id: `company-${date}-${index + 1}`,
      section: "companyNews",
      timestamp: `${line.slice(2, 12)}T12:00:00.000Z`,
      source: "Finnhub company-news",
      text: line.slice(13).replace(/\s+/g, " ").trim(),
    }));
  const macro = MACRO_EVENTS.get(date);
  return {
    decisionTimestamp,
    companyNews: companyNews.length
      ? companyNews
      : [
          {
            id: `company-${date}-summary`,
            section: "companyNews",
            timestamp: `${date}T12:00:00.000Z`,
            source: "Finnhub company-news summary",
            text: summary.replace(/\s+/g, " ").slice(0, 280),
          },
        ],
    scheduledMacro: macro
      ? [
          {
            id: macro.id,
            section: "scheduledMacro",
            timestamp: macro.timestamp,
            source: "committed macro calendar fixture",
            text: macro.text,
          },
        ]
      : [
          {
            id: `macro-${date}-none`,
            section: "scheduledMacro",
            timestamp: `${date}T12:00:00.000Z`,
            source: "committed macro calendar fixture",
            text: "No scheduled CPI, jobs, or FOMC catalyst is recorded for this date in the committed audit fixture.",
          },
        ],
    indexFutures: [
      {
        id: `index-futures-${date}`,
        section: "indexFutures",
        timestamp: `${date}T12:00:00.000Z`,
        source: "committed pre-open futures context",
        text: macro
          ? "Broad index-futures context should be treated as event-linked until a live futures feed confirms otherwise."
          : "No committed pre-open S&P/Nasdaq futures shock is recorded for this date.",
      },
    ],
    crossAsset: [
      {
        id: `cross-asset-${date}`,
        section: "crossAsset",
        timestamp: `${date}T12:00:00.000Z`,
        source: "committed cross-asset context",
        text: macro
          ? "DXY/VIX/rates context is flagged as macro-sensitive for this open."
          : "No committed DXY, VIX, or rates shock is recorded for this date.",
      },
    ],
  };
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
    const res = await fetchTextWithRetry(url, undefined, {
      timeoutMs: 20_000,
      retries: 2,
      maxResponseChars: 1_000_000,
    });
    if (!res.ok) {
      summary = `Finnhub HTTP ${res.status} for ${underlying} ${from}..${to}.`;
    } else {
      const arr = JSON.parse(res.text);
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

  contexts.push({
    date,
    newsSummary: summary,
    catalystBundle: catalystBundleFor(date, summary),
    headlineCount,
    appleCount,
  });
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
