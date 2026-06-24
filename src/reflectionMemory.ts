import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { canonicalJson } from "./canonicalJson";
import { GENESIS_HASH } from "./glassbox";
import type {
  ReflectionLesson,
  ReflectionLessonContext,
} from "./convergenceGate";
import type { ChatMessage } from "./qwen";

export const REFLECTION_KIND = "reflection";
export const LLM_REFLECTION_LABEL = "LLM_REFLECTION";
const PROMPT_VERSION = "reflection-memory-v1";

export interface MemoryRecordInput {
  agentId: string;
  kind: string;
  payload: unknown;
  ts: string;
}

export interface MemoryRecord extends MemoryRecordInput {
  prevHash: string;
  hash: string;
}

export interface ExtractedDecision {
  agentId: string;
  kind: string;
  hash: string;
  ts: string;
  symbol: string;
  direction: "long" | "short" | "flat";
  entryPrice: number;
  benchmarkEntryPrice: number | null;
}

export interface RealizedDecisionPrices {
  exitTs: string;
  exitPrice: number;
  benchmarkExitPrice: number;
  entryPrice?: number;
  benchmarkEntryPrice?: number;
  benchmarkName?: string;
}

export interface DecisionOutcome {
  resolvedDecisionHash: string;
  decisionTs: string;
  resolvedAt: string;
  symbol: string;
  direction: "long" | "short" | "flat";
  entryPrice: number;
  exitPrice: number;
  benchmarkName: string;
  benchmarkEntryPrice: number;
  benchmarkExitPrice: number;
  rawReturnPct: number;
  benchmarkReturnPct: number;
  alphaPct: number;
  holdingWindowMs: number;
  costPct: number;
}

export interface ResolvedDecision {
  decision: ExtractedDecision;
  record: MemoryRecord;
  outcome: DecisionOutcome;
}

export interface ReflectionArtifact {
  label: typeof LLM_REFLECTION_LABEL;
  promptVersion: typeof PROMPT_VERSION;
  model?: string;
  generatedAt: string;
  text: string;
}

export interface ReflectionPayload {
  schemaVersion: 1;
  resolvedDecisionHash: string;
  outcome: DecisionOutcome;
  lesson: string;
  artifact: ReflectionArtifact;
}

export interface ReflectionVerification {
  ok: boolean;
  count: number;
  finalHash: string;
  errors: string[];
}

export type DecisionPriceResolver = (
  record: MemoryRecord,
  decision: ExtractedDecision,
) => RealizedDecisionPrices | null;

export type ReflectFn = (messages: ChatMessage[]) => Promise<string>;

function hashMemoryRecord(
  input: MemoryRecordInput & { prevHash: string },
): string {
  return createHash("sha256").update(canonicalJson(input)).digest("hex");
}

export function sealMemoryRecord(
  input: MemoryRecordInput,
  prevHash: string,
): MemoryRecord {
  return {
    ...input,
    prevHash,
    hash: hashMemoryRecord({ ...input, prevHash }),
  };
}

export function formatMemoryRecord(record: MemoryRecord): string {
  return canonicalJson(record);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function parseMemoryRecord(value: unknown, line: number): MemoryRecord {
  const record = asRecord(value);
  if (!record) throw new Error(`line ${line}: record must be an object`);
  if (typeof record.agentId !== "string" || record.agentId.length === 0) {
    throw new Error(`line ${line}: agentId is required`);
  }
  if (typeof record.kind !== "string" || record.kind.length === 0) {
    throw new Error(`line ${line}: kind is required`);
  }
  if (typeof record.ts !== "string" || record.ts.length === 0) {
    throw new Error(`line ${line}: ts is required`);
  }
  if (typeof record.prevHash !== "string") {
    throw new Error(`line ${line}: prevHash is required`);
  }
  if (typeof record.hash !== "string") {
    throw new Error(`line ${line}: hash is required`);
  }
  if (!("payload" in record)) {
    throw new Error(`line ${line}: payload is required`);
  }
  return record as unknown as MemoryRecord;
}

export function parseMemoryRecords(raw: string): MemoryRecord[] {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => parseMemoryRecord(JSON.parse(line), index + 1));
}

export function readReflectionChain(path: string): MemoryRecord[] {
  if (!existsSync(path)) return [];
  return parseMemoryRecords(readFileSync(path, "utf8"));
}

function stripHash(record: MemoryRecord): MemoryRecordInput {
  return {
    agentId: record.agentId,
    kind: record.kind,
    payload: record.payload,
    ts: record.ts,
  };
}

const HEX_64 = /^[a-f0-9]{64}$/;

export function verifyReflectionRecords(
  records: MemoryRecord[],
): ReflectionVerification {
  const errors: string[] = [];
  let expectedPrev = GENESIS_HASH;
  let finalHash = GENESIS_HASH;

  records.forEach((record, index) => {
    const row = index + 1;
    if (!HEX_64.test(record.prevHash)) {
      errors.push(
        `line ${row}: prevHash must be a 64-char lowercase hex string`,
      );
    }
    if (!HEX_64.test(record.hash)) {
      errors.push(`line ${row}: hash must be a 64-char lowercase hex string`);
    }
    if (record.prevHash !== expectedPrev) {
      errors.push(
        `line ${row}: prevHash ${record.prevHash} does not match expected ${expectedPrev}`,
      );
    }
    const expectedHash = hashMemoryRecord({
      ...stripHash(record),
      prevHash: record.prevHash,
    });
    if (record.hash !== expectedHash) {
      errors.push(
        `line ${row}: hash ${record.hash} does not match expected ${expectedHash}`,
      );
    }
    expectedPrev = record.hash;
    finalHash = record.hash;
  });

  return {
    ok: errors.length === 0,
    count: records.length,
    finalHash,
    errors,
  };
}

export function appendMemoryRecord(
  path: string,
  input: MemoryRecordInput,
): MemoryRecord {
  const raw = existsSync(path) ? readFileSync(path, "utf8") : "";
  const records = parseMemoryRecords(raw);
  const prevHash = records.at(-1)?.hash ?? GENESIS_HASH;
  const record = sealMemoryRecord(input, prevHash);
  mkdirSync(dirname(path), { recursive: true });
  const separator = raw.length > 0 && !raw.endsWith("\n") ? "\n" : "";
  appendFileSync(path, `${separator}${formatMemoryRecord(record)}\n`);
  return record;
}

export function appendReflectionRecord(
  path: string,
  payload: ReflectionPayload,
  opts: { agentId?: string; ts?: string } = {},
): MemoryRecord {
  return appendMemoryRecord(path, {
    agentId: opts.agentId ?? "reflection-memory",
    kind: REFLECTION_KIND,
    payload,
    ts: opts.ts ?? payload.artifact.generatedAt,
  });
}

function getPath(value: unknown, path: string[]): unknown {
  let cursor = value;
  for (const key of path) {
    const record = asRecord(cursor);
    if (!record || !(key in record)) return undefined;
    cursor = record[key];
  }
  return cursor;
}

function firstString(value: unknown, paths: string[][]): string | null {
  for (const path of paths) {
    const candidate = getPath(value, path);
    if (typeof candidate === "string" && candidate.length > 0) return candidate;
  }
  return null;
}

function firstNumber(value: unknown, paths: string[][]): number | null {
  for (const path of paths) {
    const candidate = getPath(value, path);
    if (typeof candidate === "number" && Number.isFinite(candidate)) {
      return candidate;
    }
  }
  return null;
}

function normalizeDirection(
  value: string | null,
): ExtractedDecision["direction"] | null {
  if (!value) return null;
  const normalized = value.toLowerCase().replace(/[\s-]+/g, "_");
  if (
    normalized === "long" ||
    normalized === "buy" ||
    normalized === "open_long" ||
    normalized === "enter_long" ||
    normalized === "chase_long"
  ) {
    return "long";
  }
  if (
    normalized === "short" ||
    normalized === "sell" ||
    normalized === "open_short" ||
    normalized === "enter_short" ||
    normalized === "chase_short"
  ) {
    return "short";
  }
  if (
    normalized === "flat" ||
    normalized === "hold" ||
    normalized === "stand_aside" ||
    normalized === "standaside" ||
    normalized === "none"
  ) {
    return "flat";
  }
  return null;
}

function isDecisionKind(kind: string): boolean {
  return kind === "decision" || kind.endsWith("_decision");
}

function reflectedDecisionHash(record: MemoryRecord): string | null {
  if (record.kind !== REFLECTION_KIND) return null;
  const payload = asRecord(record.payload);
  if (!payload) return null;
  const hash = payload.resolvedDecisionHash;
  return typeof hash === "string" && hash.length > 0 ? hash : null;
}

function resolvedDecisionHashes(records: MemoryRecord[]): Set<string> {
  return new Set(
    records
      .map((record) => reflectedDecisionHash(record))
      .filter((hash): hash is string => typeof hash === "string"),
  );
}

export function extractDecision(
  record: MemoryRecord,
): ExtractedDecision | null {
  if (!isDecisionKind(record.kind)) return null;
  const symbol = firstString(record.payload, [
    ["symbol"],
    ["decision", "symbol"],
    ["perception", "symbol"],
    ["market", "symbol"],
    ["plan", "order", "symbol"],
  ]);
  const direction = normalizeDirection(
    firstString(record.payload, [
      ["direction"],
      ["winningVote"],
      ["vote"],
      ["action"],
      ["decision", "winningVote"],
      ["decision", "direction"],
      ["plan", "order", "side"],
    ]),
  );
  const entryPrice = firstNumber(record.payload, [
    ["entryPrice"],
    ["price"],
    ["tokenPrice"],
    ["market", "tokenPrice"],
    ["perception", "tokenPrice"],
    ["plan", "order", "referencePrice"],
  ]);
  const benchmarkEntryPrice = firstNumber(record.payload, [
    ["benchmarkEntryPrice"],
    ["benchmarkPrice"],
    ["referencePrice"],
    ["market", "referencePrice"],
    ["perception", "referencePrice"],
  ]);

  if (!symbol || !direction || entryPrice === null || entryPrice <= 0) {
    return null;
  }
  return {
    agentId: record.agentId,
    kind: record.kind,
    hash: record.hash,
    ts: record.ts,
    symbol,
    direction,
    entryPrice,
    benchmarkEntryPrice,
  };
}

function dateMs(value: string | Date): number {
  return value instanceof Date ? value.getTime() : Date.parse(value);
}

function roundPct(value: number): number {
  return +value.toFixed(3);
}

function directionalReturnPct(
  direction: ExtractedDecision["direction"],
  entryPrice: number,
  exitPrice: number,
): number {
  if (direction === "flat") return 0;
  if (direction === "long")
    return ((exitPrice - entryPrice) / entryPrice) * 100;
  return ((entryPrice - exitPrice) / entryPrice) * 100;
}

function positiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

export function resolveDueDecisions(params: {
  records: MemoryRecord[];
  now: string | Date;
  holdingWindowMs: number;
  priceResolver: DecisionPriceResolver;
  costPerSide?: number;
  slippageBps?: number;
  benchmarkName?: string;
}): ResolvedDecision[] {
  const nowMs = dateMs(params.now);
  const resolved = resolvedDecisionHashes(params.records);
  const totalCostPct =
    2 * ((params.costPerSide ?? 0) + (params.slippageBps ?? 0) / 10_000) * 100;
  const out: ResolvedDecision[] = [];

  for (const record of params.records) {
    if (resolved.has(record.hash)) continue;
    const decision = extractDecision(record);
    if (!decision) continue;
    const decisionMs = Date.parse(decision.ts);
    if (!Number.isFinite(decisionMs)) continue;
    if (decisionMs + params.holdingWindowMs > nowMs) continue;

    const prices = params.priceResolver(record, decision);
    if (!prices) continue;

    const entryPrice = prices.entryPrice ?? decision.entryPrice;
    const benchmarkEntryPrice =
      prices.benchmarkEntryPrice ?? decision.benchmarkEntryPrice;
    if (
      !positiveFinite(entryPrice) ||
      !positiveFinite(prices.exitPrice) ||
      benchmarkEntryPrice === null ||
      !positiveFinite(benchmarkEntryPrice) ||
      !positiveFinite(prices.benchmarkExitPrice)
    ) {
      continue;
    }

    const grossReturn = directionalReturnPct(
      decision.direction,
      entryPrice,
      prices.exitPrice,
    );
    const rawReturnPct =
      decision.direction === "flat" ? 0 : roundPct(grossReturn - totalCostPct);
    const benchmarkReturnPct = roundPct(
      ((prices.benchmarkExitPrice - benchmarkEntryPrice) /
        benchmarkEntryPrice) *
        100,
    );
    const outcome: DecisionOutcome = {
      resolvedDecisionHash: record.hash,
      decisionTs: decision.ts,
      resolvedAt: prices.exitTs,
      symbol: decision.symbol,
      direction: decision.direction,
      entryPrice,
      exitPrice: prices.exitPrice,
      benchmarkName:
        prices.benchmarkName ?? params.benchmarkName ?? "benchmark",
      benchmarkEntryPrice,
      benchmarkExitPrice: prices.benchmarkExitPrice,
      rawReturnPct,
      benchmarkReturnPct,
      alphaPct: roundPct(rawReturnPct - benchmarkReturnPct),
      holdingWindowMs: params.holdingWindowMs,
      costPct: roundPct(totalCostPct),
    };
    out.push({ decision, record, outcome });
  }

  return out;
}

export function buildReflectionMessages(
  decision: MemoryRecord,
  outcome: DecisionOutcome,
): ChatMessage[] {
  return [
    {
      role: "system",
      content:
        "You produce a labeled LLM reflection artifact for GapGuard's signed decision memory. " +
        "Write 2-4 sentences: say whether the directional call was right, cite the alpha, name what held or failed, and end with one concrete future lesson.",
    },
    {
      role: "user",
      content:
        `Outcome: ${canonicalJson(outcome)}\n` +
        `Decision record: ${canonicalJson({
          agentId: decision.agentId,
          hash: decision.hash,
          kind: decision.kind,
          payload: decision.payload,
          ts: decision.ts,
        })}\n` +
        `Label the result as ${LLM_REFLECTION_LABEL}; do not claim deterministic proof for the prose.`,
    },
  ];
}

function cleanLesson(text: string): string {
  return text
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/g, " ")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join(" ")
    .trim()
    .slice(0, 800);
}

export async function generateReflectionPayload(params: {
  decision: MemoryRecord;
  outcome: DecisionOutcome;
  reflect: ReflectFn;
  model?: string;
  generatedAt?: string;
}): Promise<ReflectionPayload> {
  const generatedAt = params.generatedAt ?? new Date().toISOString();
  const text = cleanLesson(
    await params.reflect(
      buildReflectionMessages(params.decision, params.outcome),
    ),
  );
  if (text.length === 0) {
    throw new Error("reflection artifact cannot be empty");
  }
  return {
    schemaVersion: 1,
    resolvedDecisionHash: params.outcome.resolvedDecisionHash,
    outcome: params.outcome,
    lesson: text,
    artifact: {
      label: LLM_REFLECTION_LABEL,
      promptVersion: PROMPT_VERSION,
      ...(params.model ? { model: params.model } : {}),
      generatedAt,
      text,
    },
  };
}

export async function resolveAndAppendReflections(params: {
  path: string;
  now: string | Date;
  holdingWindowMs: number;
  priceResolver: DecisionPriceResolver;
  reflect: ReflectFn;
  agentId?: string;
  model?: string;
  generatedAt?: string;
  costPerSide?: number;
  slippageBps?: number;
  benchmarkName?: string;
}): Promise<MemoryRecord[]> {
  const records = readReflectionChain(params.path);
  const due = resolveDueDecisions({
    records,
    now: params.now,
    holdingWindowMs: params.holdingWindowMs,
    priceResolver: params.priceResolver,
    costPerSide: params.costPerSide,
    slippageBps: params.slippageBps,
    benchmarkName: params.benchmarkName,
  });
  const appended: MemoryRecord[] = [];
  for (const item of due) {
    const payload = await generateReflectionPayload({
      decision: item.record,
      outcome: item.outcome,
      reflect: params.reflect,
      model: params.model,
      generatedAt: params.generatedAt,
    });
    appended.push(
      appendReflectionRecord(params.path, payload, {
        agentId: params.agentId ?? item.decision.agentId,
        ts: params.generatedAt ?? payload.artifact.generatedAt,
      }),
    );
  }
  return appended;
}

function readOutcomeNumber(
  outcome: Record<string, unknown>,
  field: keyof Pick<
    DecisionOutcome,
    "alphaPct" | "rawReturnPct" | "benchmarkReturnPct"
  >,
): number | null {
  const value = outcome[field];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function lessonFromRecord(record: MemoryRecord): ReflectionLesson | null {
  if (record.kind !== REFLECTION_KIND) return null;
  const payload = asRecord(record.payload);
  const outcome = asRecord(payload?.outcome);
  const artifact = asRecord(payload?.artifact);
  if (!payload || !outcome || !artifact) return null;
  const symbol = outcome.symbol;
  const decisionHash = payload.resolvedDecisionHash;
  const resolvedAt = outcome.resolvedAt;
  const lesson = payload.lesson;
  const artifactLabel = artifact.label;
  const alphaPct = readOutcomeNumber(outcome, "alphaPct");
  const rawReturnPct = readOutcomeNumber(outcome, "rawReturnPct");
  const benchmarkReturnPct = readOutcomeNumber(outcome, "benchmarkReturnPct");
  if (
    typeof symbol !== "string" ||
    typeof decisionHash !== "string" ||
    typeof resolvedAt !== "string" ||
    typeof lesson !== "string" ||
    typeof artifactLabel !== "string" ||
    alphaPct === null ||
    rawReturnPct === null ||
    benchmarkReturnPct === null
  ) {
    return null;
  }
  return {
    symbol,
    decisionHash,
    resolvedAt,
    alphaPct,
    rawReturnPct,
    benchmarkReturnPct,
    lesson,
    artifactLabel,
  };
}

export function selectReflectionLessons(
  records: MemoryRecord[],
  symbol: string,
  opts: { sameInstrumentLimit?: number; crossInstrumentLimit?: number } = {},
): ReflectionLessonContext {
  const sameInstrumentLimit = opts.sameInstrumentLimit ?? 3;
  const crossInstrumentLimit = opts.crossInstrumentLimit ?? 2;
  const lessons = records
    .map((record) => lessonFromRecord(record))
    .filter((lesson): lesson is ReflectionLesson => lesson !== null)
    .sort((a, b) => b.resolvedAt.localeCompare(a.resolvedAt));
  return {
    sameInstrument: lessons
      .filter((lesson) => lesson.symbol === symbol)
      .slice(0, sameInstrumentLimit),
    crossInstrument: lessons
      .filter((lesson) => lesson.symbol !== symbol)
      .slice(0, crossInstrumentLimit),
  };
}
