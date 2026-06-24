import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { buildCatalystBundle } from "./catalystBundle";
import {
  assessConvergence,
  effectiveMultiplier,
  type ChatFn,
  type GateContext,
} from "./convergenceGate";
import { qwenChat, qwenConfigFromEnv, qwenModelForRole } from "./qwen";
import {
  buildHoldoutCandidates,
  type HoldoutCandidate,
} from "./gateHoldoutReport";
import {
  holdoutCandidateKey,
  loadHoldoutGateCache,
  type HoldoutGateCache,
  type HoldoutGateVerdict,
} from "./holdoutGateCache";
import { loadCandleFixture, loadRwaSampleManifest } from "./multiBacktest";

/**
 * Map a holdout gap candidate to a gate context. A positive gap means the token
 * is rich vs the closed-market reference (fade = short); a negative gap is cheap
 * (fade = long). The macro catalyst bundle is what reaches the model.
 */
export function buildHoldoutGateContext(
  candidate: HoldoutCandidate,
  companyNews: string,
): GateContext {
  const news = companyNews.trim();
  return {
    symbol: candidate.symbol,
    direction: candidate.gapPct > 0 ? "rich" : "cheap",
    dislocationPct: candidate.gapPct / 100,
    sessionLabel: "overnight (US stock off-hours)",
    newsSummary: news.length
      ? news
      : `No company-news headlines were retrieved for ${candidate.symbol} before this open.`,
    catalystBundle: buildCatalystBundle({
      asset: candidate.symbol,
      date: candidate.date,
      newsSummary: news,
    }),
  };
}

export async function scoreHoldoutCandidates(params: {
  candidates: HoldoutCandidate[];
  news: Map<string, string>;
  chat: ChatFn;
  onProgress?: (done: number, total: number) => void;
  delayMs?: number;
}): Promise<HoldoutGateVerdict[]> {
  const verdicts: HoldoutGateVerdict[] = [];
  let done = 0;
  for (const candidate of params.candidates) {
    const companyNews = (
      params.news.get(holdoutCandidateKey(candidate.symbol, candidate.date)) ??
      ""
    ).trim();
    const ctx = buildHoldoutGateContext(candidate, companyNews);
    const hasCompanyNews = companyNews.length > 0;
    try {
      const verdict = await assessConvergence(ctx, params.chat);
      verdicts.push({
        symbol: candidate.symbol,
        date: candidate.date,
        action: verdict.action,
        multiplier: effectiveMultiplier(verdict),
        evidenceIds: verdict.evidenceIds,
        rationale: verdict.rationale,
        hasCompanyNews,
        parseError: verdict.parseError,
      });
    } catch (err) {
      // Transport/timeout failures fail closed to STAND_ASIDE so one flaky
      // call cannot abort a multi-hundred-candidate scoring run.
      verdicts.push({
        symbol: candidate.symbol,
        date: candidate.date,
        action: "STAND_ASIDE",
        multiplier: 0,
        evidenceIds: [],
        rationale: "",
        hasCompanyNews,
        parseError:
          err instanceof Error ? err.message : "scoring transport error",
      });
    }
    done += 1;
    params.onProgress?.(done, params.candidates.length);
    if (params.delayMs && done < params.candidates.length) {
      await new Promise((r) => setTimeout(r, params.delayMs));
    }
  }
  return verdicts;
}

export function loadHoldoutNews(path: string): Map<string, string> {
  const doc = JSON.parse(readFileSync(path, "utf8")) as unknown;
  if (!doc || typeof doc !== "object") {
    throw new Error(`${path} must be an object`);
  }
  const contexts = (doc as Record<string, unknown>).contexts;
  if (!Array.isArray(contexts)) {
    throw new Error(`${path}.contexts must be an array`);
  }
  const map = new Map<string, string>();
  for (const row of contexts) {
    if (!row || typeof row !== "object") continue;
    const record = row as Record<string, unknown>;
    if (
      typeof record.symbol === "string" &&
      typeof record.date === "string" &&
      typeof record.newsSummary === "string"
    ) {
      map.set(
        holdoutCandidateKey(record.symbol, record.date),
        record.newsSummary,
      );
    }
  }
  return map;
}

export async function runScoreHoldoutCli(): Promise<void> {
  const qwenConfig = qwenConfigFromEnv();
  const apiKey = qwenConfig.apiKey;
  if (!apiKey) {
    throw new Error(
      "BITGET_QWEN_API_KEY is required to score the holdout with live Qwen",
    );
  }
  const modelRole = "deep";
  const model = qwenModelForRole({ ...qwenConfig, modelRole });
  const positional = process.argv
    .slice(2)
    .filter((arg) => !arg.startsWith("--"));
  const resume = process.argv.includes("--resume");
  const manifestPath = resolve(
    positional[0] ?? "data/rwa-sample/manifest.json",
  );
  const newsPath = resolve(positional[1] ?? "data/holdout-news-contexts.json");
  const out = resolve(positional[2] ?? "data/holdout-gate-verdicts.json");
  const manifest = loadRwaSampleManifest(manifestPath);
  const fixtures = manifest.symbols.map((row) =>
    loadCandleFixture(resolve(row.file)),
  );
  const { holdout } = buildHoldoutCandidates({ fixtures });
  const news = existsSync(newsPath)
    ? loadHoldoutNews(newsPath)
    : new Map<string, string>();

  // Resume: keep good verdicts from a prior run, re-score only failed/missing
  // candidates. Lets a flaky-endpoint run be completed without redoing work.
  const prior = existsSync(out) && resume ? loadHoldoutGateCache(out) : null;
  const goodByKey = new Map<string, HoldoutGateVerdict>();
  if (prior) {
    for (const verdict of prior.verdicts) {
      if (!verdict.parseError) {
        goodByKey.set(
          holdoutCandidateKey(verdict.symbol, verdict.date),
          verdict,
        );
      }
    }
  }
  const todo = holdout.filter(
    (candidate) =>
      !goodByKey.has(holdoutCandidateKey(candidate.symbol, candidate.date)),
  );

  const chat: ChatFn = (messages) =>
    qwenChat(messages, {
      ...qwenConfig,
      apiKey,
      modelRole,
      retries: 3,
      timeoutMs: 60_000,
    });
  console.log(
    `scoring ${todo.length}/${holdout.length} holdout candidates (resume kept ${goodByKey.size}) with live Qwen + macro catalyst bundle...`,
  );
  const fresh = await scoreHoldoutCandidates({
    candidates: todo,
    news,
    chat,
    delayMs: 400,
    onProgress: (done, total) => {
      if (done % 25 === 0 || done === total) {
        console.log(`  scored ${done}/${total}`);
      }
    },
  });
  const freshByKey = new Map(
    fresh.map((verdict) => [
      holdoutCandidateKey(verdict.symbol, verdict.date),
      verdict,
    ]),
  );
  const verdicts = holdout.map((candidate) => {
    const key = holdoutCandidateKey(candidate.symbol, candidate.date);
    return freshByKey.get(key) ?? goodByKey.get(key)!;
  });
  const symbols = [...new Set(holdout.map((candidate) => candidate.symbol))];
  const cache: HoldoutGateCache = {
    generatedAt: new Date().toISOString(),
    model,
    symbols,
    newsSource: news.size
      ? newsPath.replaceAll("\\", "/")
      : "macro/index/cross-asset bundle only (no company-news file present)",
    verdicts,
  };
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(cache, null, 2)}\n`);
  const failClosed = verdicts.filter((verdict) => verdict.parseError).length;
  console.log(
    `holdout gate scoring: ${verdicts.length} verdicts (${failClosed} fail-closed) -> ${out}`,
  );
}

if (process.argv[1]?.endsWith("holdoutGateScoring.ts")) {
  await runScoreHoldoutCli();
}
