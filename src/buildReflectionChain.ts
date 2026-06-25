import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  formatMemoryRecord,
  generateReflectionPayload,
  sealMemoryRecord,
  type DecisionOutcome,
  type MemoryRecord,
  type ReflectFn,
} from "./reflectionMemory";
import { qwenConfigFromEnv } from "./qwen";

// Wires the (already-built, tested) reflection memory into a real, public,
// signed reflection chain over GapGuard's recorded AAPL gate decisions. Every
// number is real: the decision + realized return come from gate-verdicts.json,
// entry prices from the committed AAPL candle fixture, the lesson from a live
// Qwen call. The chain is sha256-linked via sealMemoryRecord and verifiable.

const GENESIS = "0".repeat(64);
const HOLDING_MS = 24 * 60 * 60 * 1000; // ~1 trading day to the next session
const COST_PCT = 0.1; // round-trip fee + slippage, matches the backtest haircut

interface Candle {
  ts: number;
  close: number;
}

function loadQwenKey(env = process.env): string | null {
  const fromEnv = env.BITGET_QWEN_API_KEY?.trim();
  if (fromEnv) return fromEnv;
  const keyFile = env.BITGET_QWEN_API_KEY_FILE?.trim() || ".qwenkey";
  const full = resolve(keyFile);
  if (existsSync(full)) {
    const value = readFileSync(full, "utf8").trim();
    if (value) return value;
  }
  return null;
}

function loadCandles(path: string): Candle[] {
  const raw = JSON.parse(readFileSync(resolve(path), "utf8")) as unknown;
  const arr = Array.isArray(raw)
    ? raw
    : ((raw as { candles?: unknown[]; data?: unknown[] }).candles ??
      (raw as { data?: unknown[] }).data ??
      []);
  return (arr as { ts: number; close: number }[])
    .filter((c) => Number.isFinite(c.ts) && Number.isFinite(c.close))
    .sort((a, b) => a.ts - b.ts);
}

/** Latest real candle close at or before the target time. */
function closeAt(candles: Candle[], targetMs: number): number | null {
  let hit: number | null = null;
  for (const c of candles) {
    if (c.ts <= targetMs) hit = c.close;
    else break;
  }
  return hit;
}

function round(value: number, dp = 4): number {
  return Number(value.toFixed(dp));
}

export async function buildReflectionChain(): Promise<{
  records: MemoryRecord[];
  reflected: number;
  skipped: number;
}> {
  const verdictsPath = resolve("public/gate-verdicts.json");
  const candlesPath = resolve("data/aaplusdt-1h.json");
  const out = resolve(process.argv[2] ?? "public/reflection-chain.jsonl");

  const verdicts = (
    JSON.parse(readFileSync(verdictsPath, "utf8")) as {
      verdicts: {
        date: string;
        action: string;
        fadeable: boolean;
        returnPct: number;
        correct: boolean;
        multiplier: number;
      }[];
    }
  ).verdicts;
  const candles = loadCandles(candlesPath);
  const apiKey = loadQwenKey();
  if (!apiKey) {
    throw new Error(
      "BITGET_QWEN_API_KEY (or .qwenkey) required to generate real reflection lessons",
    );
  }
  const qcfg = qwenConfigFromEnv();
  const model = qcfg.deepModel ?? "qwen3.6-plus";
  const baseUrl = "https://hackathon.bitgetops.com/v1";
  // The shared qwenChat wrapper 400s on this longer reflection prompt; the plain
  // chat/completions request works, so call it directly here.
  const reflect: ReflectFn = async (messages) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 45_000);
    try {
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ model, messages, max_tokens: 1200 }),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        throw new Error(
          `Qwen ${res.status}: ${(await res.text()).slice(0, 80)}`,
        );
      }
      const data = (await res.json()) as {
        choices?: { message?: { content?: string } }[];
      };
      const content = data.choices?.[0]?.message?.content?.trim() ?? "";
      if (!content) throw new Error("empty reflection content");
      return content;
    } finally {
      clearTimeout(timer);
    }
  };

  const records: MemoryRecord[] = [];
  let prevHash = GENESIS;
  let reflected = 0;
  let skipped = 0;

  for (const v of verdicts) {
    const decisionMs = Date.parse(`${v.date}T13:00:00.000Z`); // pre-US-open
    const entryPrice = closeAt(candles, decisionMs);
    const benchmarkExitPrice = closeAt(candles, decisionMs + HOLDING_MS);
    if (
      entryPrice === null ||
      benchmarkExitPrice === null ||
      entryPrice <= 0 ||
      benchmarkExitPrice <= 0
    ) {
      skipped += 1;
      continue;
    }

    // Decision direction: STAND_ASIDE = no position; a FADE bets against the
    // off-hours move (modelled short of the premium). Outcome return is the
    // real recorded trade return; the implied exit is consistent with it.
    const direction: "long" | "short" | "flat" =
      v.action === "STAND_ASIDE" ? "flat" : "short";
    const rawReturnPct = round(v.returnPct);
    const exitPrice =
      direction === "flat"
        ? entryPrice
        : round(entryPrice * (1 - rawReturnPct / 100), 4); // short: +return => lower exit
    const benchmarkReturnPct = round(
      ((benchmarkExitPrice - entryPrice) / entryPrice) * 100,
    );

    const outcome: DecisionOutcome = {
      resolvedDecisionHash: prevHash, // links to the running chain head
      decisionTs: new Date(decisionMs).toISOString(),
      resolvedAt: new Date(decisionMs + HOLDING_MS).toISOString(),
      symbol: "AAPLUSDT",
      direction,
      entryPrice: round(entryPrice),
      exitPrice,
      benchmarkName: "AAPL buy-and-hold to next session",
      benchmarkEntryPrice: round(entryPrice),
      benchmarkExitPrice: round(benchmarkExitPrice),
      rawReturnPct,
      benchmarkReturnPct,
      alphaPct: round(rawReturnPct - benchmarkReturnPct),
      holdingWindowMs: HOLDING_MS,
      costPct: COST_PCT,
    };

    const decisionRecord: MemoryRecord = sealMemoryRecord(
      {
        agentId: "gapguard-gate",
        kind: "gate_decision",
        payload: {
          date: v.date,
          action: v.action,
          fadeable: v.fadeable,
          multiplier: v.multiplier,
          correct: v.correct,
        },
        ts: outcome.decisionTs,
      },
      prevHash,
    );

    let payload;
    try {
      payload = await generateReflectionPayload({
        decision: decisionRecord,
        outcome,
        reflect,
        model: qcfg.deepModel ?? "qwen3.6-plus",
        generatedAt: outcome.resolvedAt,
      });
    } catch (err) {
      // Flaky endpoint: skip this one decision, keep the chain going.
      skipped += 1;
      console.error(
        `  reflection skipped ${v.date}: ${err instanceof Error ? err.message.slice(0, 60) : "failed"}`,
      );
      continue;
    }

    const record = sealMemoryRecord(
      {
        agentId: "gapguard-gate",
        kind: "reflection",
        payload,
        ts: outcome.resolvedAt,
      },
      prevHash,
    );
    records.push(record);
    prevHash = record.hash;
    reflected += 1;
  }

  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(
    out,
    records.map((r) => formatMemoryRecord(r)).join("\n") +
      (records.length ? "\n" : ""),
  );
  console.log(
    `reflection chain: ${out}; ${reflected} reflections, ${skipped} skipped, finalHash ${prevHash.slice(0, 12)}`,
  );
  return { records, reflected, skipped };
}

if (process.argv[1]?.endsWith("buildReflectionChain.ts")) {
  await buildReflectionChain().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
