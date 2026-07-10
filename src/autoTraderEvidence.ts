import { createHash } from "node:crypto";
import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import {
  appendAttestedArenaRecord,
  replaceAttestedArenaRecords,
  type AttestedArenaConfig,
  type ArenaRecord,
  type ArenaRecordInput,
} from "./arena-chain";
import {
  isOpeningTradeSide,
  type AutoTraderExchangeOrder,
} from "./autoTraderExchange";
import type {
  AutoTraderDailyState,
  PendingOrderTerminalStatus,
  PendingOrderEvidence,
  TerminalPendingOrderReservation,
} from "./autoTraderState";
import { acknowledgePendingOrderEvidence } from "./autoTraderState";
import { canonicalJson } from "./canonicalJson";

export type AutoTraderEvidenceStatus =
  | "dry_run"
  | "submitted"
  | "filled"
  | "cancelled"
  | "timeout"
  | "error";

export interface AutoTraderEvidenceRow {
  ts: string;
  trigger: "auto";
  mode: "dry_run" | "live";
  status: AutoTraderEvidenceStatus;
  [key: string]: unknown;
}

export interface AutoTraderEvidenceOptions {
  journalPath: string;
  attestedArena?: AttestedArenaConfig;
  agentId?: string;
}

export interface AutoTraderEvidenceResult {
  row: AutoTraderEvidenceRow;
  journalAppended: boolean;
  chainAppended: boolean;
}

export interface DurableLiveAutoTraderEvidenceRow
  extends AutoTraderEvidenceRow, PendingOrderEvidence {
  eventId: string;
  mode: "live";
}

export interface PendingOrderEvidenceReplayResult extends AutoTraderEvidenceResult {
  state: AutoTraderDailyState;
}

export interface ReconciledOrderEvidenceRow extends AutoTraderEvidenceRow {
  eventId: string;
  mode: "live";
  status: PendingOrderTerminalStatus;
  reconciliation: "exchange_history";
  symbol: string;
  clientOid: string;
  orderId: string;
  reservedAt: string;
  exchangeOrder: AutoTraderExchangeOrder;
}

const EVIDENCE_STATUSES = new Set<AutoTraderEvidenceStatus>([
  "dry_run",
  "submitted",
  "filled",
  "cancelled",
  "timeout",
  "error",
]);

export function validateAutoTraderEvidenceRow(
  value: unknown,
): AutoTraderEvidenceRow {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("auto-trader evidence row must be an object");
  }
  const row = value as Record<string, unknown>;
  if (row.trigger !== "auto") {
    throw new Error('auto-trader evidence trigger must be exactly "auto"');
  }
  if (typeof row.ts !== "string") {
    throw new Error(
      "auto-trader evidence ts must be a canonical ISO timestamp",
    );
  }
  const timestamp = new Date(row.ts);
  if (
    !Number.isFinite(timestamp.getTime()) ||
    timestamp.toISOString() !== row.ts
  ) {
    throw new Error(
      "auto-trader evidence ts must be a canonical ISO timestamp",
    );
  }
  if (row.mode !== "dry_run" && row.mode !== "live") {
    throw new Error("auto-trader evidence mode must be dry_run or live");
  }
  if (!EVIDENCE_STATUSES.has(row.status as AutoTraderEvidenceStatus)) {
    throw new Error("auto-trader evidence status is invalid");
  }
  if (
    row.mode === "dry_run" &&
    row.status !== "dry_run" &&
    row.status !== "error"
  ) {
    throw new Error("dry-run evidence status must be dry_run or error");
  }
  if (row.mode === "live" && row.status === "dry_run") {
    throw new Error("live evidence status cannot be dry_run");
  }
  if (
    row.eventId !== undefined &&
    (typeof row.eventId !== "string" || row.eventId.trim().length === 0)
  ) {
    throw new Error("auto-trader evidence eventId must be non-empty");
  }
  return JSON.parse(canonicalJson(row)) as AutoTraderEvidenceRow;
}

export function prepareLiveAutoTraderEvidence(
  value: unknown,
): DurableLiveAutoTraderEvidenceRow {
  const row = validateAutoTraderEvidenceRow(value);
  if (row.mode !== "live") {
    throw new Error("durable pending-order evidence must be live");
  }
  if (typeof row.eventId === "string") {
    return row as DurableLiveAutoTraderEvidenceRow;
  }
  const eventId = `ggauto-outcome-${createHash("sha256")
    .update(canonicalJson(row))
    .digest("hex")}`;
  return validateAutoTraderEvidenceRow({
    ...row,
    eventId,
  }) as DurableLiveAutoTraderEvidenceRow;
}

function appendJournalRow(path: string, row: AutoTraderEvidenceRow): void {
  mkdirSync(dirname(path), { recursive: true });
  const fd = openSync(path, "a");
  try {
    writeFileSync(fd, `${canonicalJson(row)}\n`, "utf8");
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function isErrno(error: unknown, code: string): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === code
  );
}

function existingJournalEvent(
  path: string,
  eventId: string,
): Record<string, unknown> | null {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    if (isErrno(error, "ENOENT")) return null;
    throw error;
  }
  let match: Record<string, unknown> | null = null;
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    if (line.trim().length === 0) continue;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(
        `invalid evidence journal at ${path} line ${index + 1}: ${detail}`,
      );
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const row = value as Record<string, unknown>;
    if (row.eventId !== eventId) continue;
    if (match && canonicalJson(match) !== canonicalJson(row)) {
      throw new Error(`conflicting evidence eventId ${eventId} in journal`);
    }
    match = row;
  }
  return match;
}

function appendJournalRowIdempotently(
  path: string,
  row: AutoTraderEvidenceRow,
): boolean {
  if (typeof row.eventId !== "string") {
    appendJournalRow(path, row);
    return true;
  }
  const existing = existingJournalEvent(path, row.eventId);
  if (existing) {
    if (canonicalJson(existing) !== canonicalJson(row)) {
      throw new Error(`conflicting evidence eventId ${row.eventId} in journal`);
    }
    return false;
  }
  appendJournalRow(path, row);
  return true;
}

function arenaInput(record: ArenaRecord): ArenaRecordInput {
  return {
    ts: record.ts,
    kind: record.kind,
    agentId: record.agentId,
    payload: record.payload,
  };
}

function appendArenaRowIdempotently(
  row: AutoTraderEvidenceRow,
  agentId: string,
  config: AttestedArenaConfig,
): boolean {
  if (typeof row.eventId !== "string") {
    appendAttestedArenaRecord(
      { ts: row.ts, kind: "broker_order", agentId, payload: row },
      config,
    );
    return true;
  }
  let appended = false;
  replaceAttestedArenaRecords(
    (existing) => {
      const matches = existing.filter((record) => {
        if (
          record.kind !== "broker_order" ||
          !record.payload ||
          typeof record.payload !== "object" ||
          Array.isArray(record.payload)
        ) {
          return false;
        }
        return (
          (record.payload as Record<string, unknown>).eventId === row.eventId
        );
      });
      if (
        matches.some(
          (record) =>
            record.agentId !== agentId ||
            canonicalJson(record.payload) !== canonicalJson(row),
        )
      ) {
        throw new Error(
          `conflicting evidence eventId ${row.eventId} in Arena chain`,
        );
      }
      const inputs = existing.map(arenaInput);
      if (matches.length > 0) return inputs;
      appended = true;
      return [
        ...inputs,
        { ts: row.ts, kind: "broker_order", agentId, payload: row },
      ];
    },
    config,
    new Date(row.ts),
  );
  return appended;
}

function reconciliationEventId(
  pending: TerminalPendingOrderReservation,
): string {
  const digest = createHash("sha256")
    .update(
      canonicalJson({
        clientOid: pending.clientOid,
        orderId: pending.orderId,
        status: pending.status,
        symbol: pending.symbol,
      }),
    )
    .digest("hex");
  return `ggauto-reconcile-${digest}`;
}

export function buildReconciledOrderEvidence(
  pending: TerminalPendingOrderReservation,
  exchangeOrder: AutoTraderExchangeOrder,
): ReconciledOrderEvidenceRow {
  const expectedStatuses =
    pending.status === "filled"
      ? new Set(["filled"])
      : new Set(["canceled", "cancelled", "rejected"]);
  if (!expectedStatuses.has(exchangeOrder.status.toLowerCase())) {
    throw new Error(
      `exchange order status ${exchangeOrder.status} does not match terminal state ${pending.status}`,
    );
  }
  if (!isOpeningTradeSide(exchangeOrder.tradeSide)) {
    throw new Error("terminal reconciliation evidence requires an open order");
  }
  if (exchangeOrder.orderId !== pending.orderId) {
    throw new Error("exchange orderId does not match the pending reservation");
  }
  if (
    exchangeOrder.clientOid !== null &&
    exchangeOrder.clientOid !== pending.clientOid
  ) {
    throw new Error(
      "exchange clientOid does not match the pending reservation",
    );
  }
  if (exchangeOrder.symbol !== pending.symbol) {
    throw new Error("exchange symbol does not match the pending reservation");
  }
  const timestamp = new Date(exchangeOrder.createdAt);
  if (!Number.isFinite(timestamp.getTime())) {
    throw new Error("exchange order createdAt must be a valid timestamp");
  }
  return validateAutoTraderEvidenceRow({
    ts: timestamp.toISOString(),
    trigger: "auto",
    mode: "live",
    status: pending.status,
    eventId: reconciliationEventId(pending),
    reconciliation: "exchange_history",
    symbol: pending.symbol,
    clientOid: pending.clientOid,
    orderId: pending.orderId,
    reservedAt: pending.reservedAt,
    exchangeOrder,
  }) as ReconciledOrderEvidenceRow;
}

export function appendAutoTraderEvidence(
  value: unknown,
  options: AutoTraderEvidenceOptions,
): AutoTraderEvidenceResult {
  const row = validateAutoTraderEvidenceRow(value);
  const journalAppended = appendJournalRowIdempotently(
    options.journalPath,
    row,
  );
  if (row.mode === "dry_run") {
    return { row, journalAppended, chainAppended: false };
  }
  if (!options.attestedArena) {
    throw new Error("live auto-trader evidence requires attested Arena config");
  }
  const agentId = options.agentId ?? "quorum";
  if (agentId.trim().length === 0) {
    throw new Error("auto-trader evidence agentId must be non-empty");
  }
  const chainAppended = appendArenaRowIdempotently(
    row,
    agentId,
    options.attestedArena,
  );
  return { row, journalAppended, chainAppended };
}

export function replayPendingOrderEvidence(
  state: AutoTraderDailyState,
  options: AutoTraderEvidenceOptions,
): PendingOrderEvidenceReplayResult {
  const pending = state.pendingOrder;
  if (!pending) {
    throw new Error("cannot replay evidence: no pending order exists");
  }
  if (!pending.evidence) {
    throw new Error(
      `cannot replay evidence: pending order ${pending.clientOid} has no staged evidence`,
    );
  }
  const result = appendAutoTraderEvidence(pending.evidence, options);
  return {
    ...result,
    state: acknowledgePendingOrderEvidence(
      state,
      pending.clientOid,
      pending.evidence.eventId,
    ),
  };
}
