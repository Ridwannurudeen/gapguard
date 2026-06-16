import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { GlassBox, formatRecord, type DecisionRecord } from "./glassbox";
import { verifyRecords } from "./logVerifier";
import { decide, type MarketTick, type Portfolio } from "./pipeline";

interface ReplayTick extends MarketTick {
  newsSummary?: string;
  gate?: {
    multiplier: number;
    rationale?: string;
  };
}

interface ReplayDataset {
  name: string;
  proofScope: string;
  notes: string;
  initialPortfolio: Portfolio;
  ticks: ReplayTick[];
}

export interface ReplayRun {
  dataset: ReplayDataset;
  records: DecisionRecord[];
  finalEquity: number;
  returnPct: number;
  verification: ReturnType<typeof verifyRecords>;
}

function assertNumber(value: unknown, field: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${field} must be a finite number`);
  }
}

function parseDataset(raw: string): ReplayDataset {
  const parsed = JSON.parse(raw) as Partial<ReplayDataset>;
  if (typeof parsed.name !== "string") throw new Error("name is required");
  if (typeof parsed.proofScope !== "string")
    throw new Error("proofScope is required");
  if (typeof parsed.notes !== "string") throw new Error("notes is required");
  if (!parsed.initialPortfolio) throw new Error("initialPortfolio is required");
  assertNumber(parsed.initialPortfolio.equity, "initialPortfolio.equity");
  assertNumber(parsed.initialPortfolio.exposure, "initialPortfolio.exposure");
  assertNumber(
    parsed.initialPortfolio.drawdownPct,
    "initialPortfolio.drawdownPct",
  );
  if (!Array.isArray(parsed.ticks) || parsed.ticks.length === 0) {
    throw new Error("ticks must be a non-empty array");
  }

  parsed.ticks.forEach((tick, index) => {
    const row = `ticks[${index}]`;
    if (typeof tick.ts !== "string") throw new Error(`${row}.ts is required`);
    if (typeof tick.symbol !== "string")
      throw new Error(`${row}.symbol is required`);
    assertNumber(tick.tokenPrice, `${row}.tokenPrice`);
    assertNumber(tick.referencePrice, `${row}.referencePrice`);
    assertNumber(tick.volatility, `${row}.volatility`);
  });

  return parsed as ReplayDataset;
}

export function loadReplayDataset(path: string): ReplayDataset {
  return parseDataset(readFileSync(path, "utf8"));
}

export function runReplayDataset(dataset: ReplayDataset): ReplayRun {
  const gb = new GlassBox();
  let equity = dataset.initialPortfolio.equity;
  let exposure = dataset.initialPortfolio.exposure;
  let peak = equity;
  let prevPrice: number | null = null;

  for (const tick of dataset.ticks) {
    if (prevPrice !== null) {
      equity += exposure * ((tick.tokenPrice - prevPrice) / prevPrice);
    }
    peak = Math.max(peak, equity);
    const drawdownPct = (peak - equity) / peak;
    const rec = decide(
      tick,
      { equity, exposure, drawdownPct },
      gb,
      undefined,
      tick.gate,
    );
    exposure = rec.risk.targetNotional;
    prevPrice = tick.tokenPrice;
  }

  const records = gb.all();
  return {
    dataset,
    records,
    finalEquity: equity,
    returnPct:
      ((equity - dataset.initialPortfolio.equity) /
        dataset.initialPortfolio.equity) *
      100,
    verification: verifyRecords(records),
  };
}

export function writeReplayArtifacts(
  run: ReplayRun,
  jsonlPath: string,
  dashboardPath: string,
): void {
  mkdirSync(dirname(jsonlPath), { recursive: true });
  mkdirSync(dirname(dashboardPath), { recursive: true });
  writeFileSync(jsonlPath, `${run.records.map(formatRecord).join("\n")}\n`);
  writeFileSync(
    dashboardPath,
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        dataset: {
          name: run.dataset.name,
          proofScope: run.dataset.proofScope,
          notes: run.dataset.notes,
        },
        summary: {
          decisions: run.records.length,
          finalEquity: run.finalEquity,
          returnPct: run.returnPct,
          verification: run.verification,
        },
        records: run.records,
      },
      null,
      2,
    )}\n`,
  );
}

function row(...cells: string[]): string {
  return cells.map((s, i) => s.padEnd([18, 9, 8, 12, 13, 11][i])).join("");
}

export function printReplay(run: ReplayRun): void {
  console.log(
    row("Time (ET)", "Session", "Price", "Dislocation", "Action", "Target"),
  );
  console.log("-".repeat(72));
  for (const rec of run.records) {
    console.log(
      row(
        rec.session.etTime.replace(" ET", ""),
        rec.session.session,
        rec.market.tokenPrice.toFixed(2),
        `${rec.dislocation.direction} ${(rec.dislocation.confidence * 100).toFixed(0)}%`,
        rec.risk.action,
        rec.risk.targetNotional.toFixed(0),
      ),
    );
  }
  console.log("-".repeat(72));
  console.log(
    `Final equity: ${run.finalEquity.toFixed(2)} | Return: ${run.returnPct >= 0 ? "+" : ""}${run.returnPct.toFixed(2)}% | Hash chain: ${run.verification.ok ? "valid" : "invalid"}`,
  );
}

export function runReplayCli(): void {
  const datasetPath = resolve(process.argv[2] ?? "data/tslax-replay.json");
  const jsonlPath = resolve(process.argv[3] ?? "glassbox-demo.jsonl");
  const dashboardPath = resolve(
    process.argv[4] ?? "public/dashboard-data.json",
  );
  const run = runReplayDataset(loadReplayDataset(datasetPath));
  writeReplayArtifacts(run, jsonlPath, dashboardPath);
  printReplay(run);
  console.log(`JSONL audit trail: ${jsonlPath}`);
  console.log(`Dashboard data: ${dashboardPath}`);
}
