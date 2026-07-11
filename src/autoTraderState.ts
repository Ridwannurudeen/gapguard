import { randomUUID } from "node:crypto";
import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { canonicalJson } from "./canonicalJson";

export type PendingOrderTerminalStatus = "filled" | "cancelled";

export type PendingOrderStatus =
  | "reserved"
  | "submitted"
  | "timeout"
  | PendingOrderTerminalStatus;

export interface PendingOrderEvidence {
  readonly eventId: string;
  readonly [key: string]: unknown;
}

export interface PendingOrderReservation {
  readonly clientOid: string;
  readonly symbol: string;
  readonly reservedAt: string;
  readonly status: PendingOrderStatus;
  readonly orderId?: string;
  readonly evidence?: PendingOrderEvidence;
}

export type TerminalPendingOrderReservation = PendingOrderReservation & {
  readonly status: PendingOrderTerminalStatus;
  readonly orderId: string;
};

export interface AutoTraderDailyState {
  readonly date: string;
  readonly tradesOpened: number;
  readonly realizedPnlUSDT: number;
  readonly killSwitchTripped: boolean;
  readonly killSwitchReason: string | null;
  readonly pendingOrder: PendingOrderReservation | null;
}

export interface AutoTraderConfig {
  readonly enabled: boolean;
  readonly maxTradesPerDay: number;
  readonly maxDailyLossUSDT: number;
  readonly statePath: string;
  readonly killSwitchPath: string;
  readonly lockPath: string;
  readonly maxPositionPct: number;
  readonly lockMaxAgeMs: number;
}

export interface AutoTraderGateResult {
  readonly allowed: boolean;
  readonly reason?: string;
}

export interface AutoTraderLockRecord {
  readonly ownerToken: string;
  readonly pid: number;
  readonly startedAt: string;
}

export interface AutoTraderLock extends AutoTraderLockRecord {
  readonly path: string;
}

export type AutoTraderLockResult =
  | {
      readonly acquired: true;
      readonly recoveredStale: boolean;
      readonly lock: AutoTraderLock;
    }
  | { readonly acquired: false; readonly reason: string };

type UnknownRecord = Record<string, unknown>;

function isErrno(error: unknown, code: string): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === code
  );
}

function asRecord(value: unknown, path: string): UnknownRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${path} must be an object`);
  }
  return value as UnknownRecord;
}

function assertKeys(
  record: UnknownRecord,
  allowed: readonly string[],
  path: string,
): void {
  const unexpected = Object.keys(record).filter(
    (key) => !allowed.includes(key),
  );
  if (unexpected.length > 0) {
    throw new Error(`${path} has unexpected field ${unexpected[0]}`);
  }
}

function readNonEmptyString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${path} must be a non-empty string`);
  }
  return value;
}

function readCanonicalInstant(value: unknown, path: string): string {
  const instant = readNonEmptyString(value, path);
  const parsed = new Date(instant);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== instant) {
    throw new Error(`${path} must be a canonical ISO timestamp`);
  }
  return instant;
}

function utcDate(now: Date): string {
  if (!Number.isFinite(now.getTime())) {
    throw new Error("now must be a valid Date");
  }
  return now.toISOString().slice(0, 10);
}

function readUtcDate(value: unknown, path: string): string {
  const date = readNonEmptyString(value, path);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`${path} must be a UTC date in YYYY-MM-DD form`);
  }
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || utcDate(parsed) !== date) {
    throw new Error(`${path} must be a valid UTC date`);
  }
  return date;
}

function readPendingOrder(
  value: unknown,
  path: string,
): PendingOrderReservation | null {
  if (value === null) return null;
  const order = asRecord(value, path);
  assertKeys(
    order,
    ["clientOid", "symbol", "reservedAt", "status", "orderId", "evidence"],
    path,
  );
  const status = order.status;
  if (
    status !== "reserved" &&
    status !== "submitted" &&
    status !== "timeout" &&
    status !== "filled" &&
    status !== "cancelled"
  ) {
    throw new Error(
      `${path}.status must be reserved, submitted, timeout, filled, or cancelled`,
    );
  }
  const orderId =
    order.orderId === undefined
      ? undefined
      : readNonEmptyString(order.orderId, `${path}.orderId`);
  if (status === "reserved" && orderId !== undefined) {
    throw new Error(`${path}.orderId is not allowed while status is reserved`);
  }
  if (
    (status === "filled" || status === "cancelled") &&
    orderId === undefined
  ) {
    throw new Error(`${path}.orderId is required while status is ${status}`);
  }
  const clientOid = readNonEmptyString(order.clientOid, `${path}.clientOid`);
  const symbol = readNonEmptyString(order.symbol, `${path}.symbol`);
  const evidence = readPendingOrderEvidence(
    order.evidence,
    `${path}.evidence`,
    {
      clientOid,
      symbol,
      status,
      orderId,
    },
  );
  return {
    clientOid,
    symbol,
    reservedAt: readCanonicalInstant(order.reservedAt, `${path}.reservedAt`),
    status,
    ...(orderId === undefined ? {} : { orderId }),
    ...(evidence === undefined ? {} : { evidence }),
  };
}

function readPendingOrderEvidence(
  value: unknown,
  path: string,
  pending: Pick<PendingOrderReservation, "clientOid" | "symbol" | "status"> & {
    readonly orderId?: string;
  },
): PendingOrderEvidence | undefined {
  if (value === undefined) return undefined;
  const row = asRecord(value, path);
  const eventId = readNonEmptyString(row.eventId, `${path}.eventId`);
  readCanonicalInstant(row.ts, `${path}.ts`);
  if (row.trigger !== "auto") {
    throw new Error(`${path}.trigger must be exactly auto`);
  }
  if (row.mode !== "live") {
    throw new Error(`${path}.mode must be exactly live`);
  }
  if (
    row.status !== "submitted" &&
    row.status !== "filled" &&
    row.status !== "cancelled" &&
    row.status !== "timeout" &&
    row.status !== "error"
  ) {
    throw new Error(`${path}.status must be a live evidence status`);
  }
  if (row.clientOid !== pending.clientOid) {
    throw new Error(`${path}.clientOid does not match the pending order`);
  }
  if (row.symbol !== pending.symbol) {
    throw new Error(`${path}.symbol does not match the pending order`);
  }
  if (
    (pending.status === "filled" || pending.status === "cancelled") &&
    row.status !== pending.status
  ) {
    throw new Error(`${path}.status does not match the terminal pending order`);
  }
  const terminal =
    pending.status === "filled" || pending.status === "cancelled";
  if (
    (terminal && row.orderId !== pending.orderId) ||
    (!terminal &&
      row.orderId !== undefined &&
      row.orderId !== null &&
      row.orderId !== pending.orderId)
  ) {
    throw new Error(`${path}.orderId does not match the pending order`);
  }
  const canonical = JSON.parse(canonicalJson(row)) as Record<string, unknown>;
  return { ...canonical, eventId };
}

function copyState(state: AutoTraderDailyState): AutoTraderDailyState {
  return {
    ...state,
    pendingOrder: readPendingOrder(state.pendingOrder, "pending order"),
  };
}

function parseConfigNumber(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  options: {
    integer?: boolean;
    minExclusive?: number;
    minInclusive?: number;
    maxInclusive?: number;
  },
): number {
  const raw = env[name];
  if (raw !== undefined && raw.trim().length === 0) {
    throw new Error(`${name} has an invalid value`);
  }
  const value = raw === undefined ? fallback : Number(raw);
  if (
    !Number.isFinite(value) ||
    (options.integer === true && !Number.isSafeInteger(value)) ||
    (options.minExclusive !== undefined && value <= options.minExclusive) ||
    (options.minInclusive !== undefined && value < options.minInclusive) ||
    (options.maxInclusive !== undefined && value > options.maxInclusive)
  ) {
    throw new Error(`${name} has an invalid value`);
  }
  return value;
}

function parseConfigPath(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: string,
): string {
  const value = env[name] ?? fallback;
  if (value.trim().length === 0) {
    throw new Error(`${name} must be a non-empty path`);
  }
  return value;
}

export function parseAutoTraderConfig(
  env: NodeJS.ProcessEnv = process.env,
): AutoTraderConfig {
  return {
    enabled: env.AUTO_TRADE_ENABLED === "true",
    maxTradesPerDay: parseConfigNumber(
      env,
      "AUTO_TRADE_MAX_TRADES_PER_DAY",
      3,
      { integer: true, minInclusive: 0 },
    ),
    maxDailyLossUSDT: parseConfigNumber(
      env,
      "AUTO_TRADE_MAX_DAILY_LOSS_USDT",
      0.3,
      { minExclusive: 0 },
    ),
    statePath: parseConfigPath(
      env,
      "AUTO_TRADE_STATE_PATH",
      "state/auto-trader-daily.json",
    ),
    killSwitchPath: parseConfigPath(
      env,
      "AUTO_TRADE_KILL_SWITCH_PATH",
      "state/AUTO_TRADE_KILL",
    ),
    lockPath: parseConfigPath(
      env,
      "AUTO_TRADE_LOCK_PATH",
      "state/auto-trader.lock",
    ),
    maxPositionPct: parseConfigNumber(env, "AUTO_TRADE_MAX_POSITION_PCT", 0.2, {
      minExclusive: 0,
      maxInclusive: 1,
    }),
    lockMaxAgeMs: parseConfigNumber(
      env,
      "AUTO_TRADE_LOCK_MAX_AGE_MS",
      600_000,
      { integer: true, minExclusive: 0 },
    ),
  };
}

export function createAutoTraderState(now: Date): AutoTraderDailyState {
  return {
    date: utcDate(now),
    tradesOpened: 0,
    realizedPnlUSDT: 0,
    killSwitchTripped: false,
    killSwitchReason: null,
    pendingOrder: null,
  };
}

export function parseAutoTraderState(
  value: unknown,
  path = "auto-trader state",
): AutoTraderDailyState {
  const state = asRecord(value, path);
  assertKeys(
    state,
    [
      "date",
      "tradesOpened",
      "realizedPnlUSDT",
      "killSwitchTripped",
      "killSwitchReason",
      "pendingOrder",
    ],
    path,
  );
  if (
    !Number.isSafeInteger(state.tradesOpened) ||
    Number(state.tradesOpened) < 0
  ) {
    throw new Error(`${path}.tradesOpened must be a non-negative integer`);
  }
  if (
    typeof state.realizedPnlUSDT !== "number" ||
    !Number.isFinite(state.realizedPnlUSDT)
  ) {
    throw new Error(`${path}.realizedPnlUSDT must be a finite number`);
  }
  if (typeof state.killSwitchTripped !== "boolean") {
    throw new Error(`${path}.killSwitchTripped must be a boolean`);
  }
  const killSwitchReason =
    state.killSwitchReason === null
      ? null
      : readNonEmptyString(state.killSwitchReason, `${path}.killSwitchReason`);
  if (state.killSwitchTripped && killSwitchReason === null) {
    throw new Error(`${path}.killSwitchReason is required when tripped`);
  }
  if (!state.killSwitchTripped && killSwitchReason !== null) {
    throw new Error(`${path}.killSwitchReason must be null when not tripped`);
  }
  const pendingOrder = readPendingOrder(
    state.pendingOrder,
    `${path}.pendingOrder`,
  );
  if (
    pendingOrder &&
    (pendingOrder.status === "filled" || pendingOrder.status === "cancelled") &&
    !pendingOrder.evidence
  ) {
    throw new Error(`${path}.terminal pending order requires staged evidence`);
  }
  return {
    date: readUtcDate(state.date, `${path}.date`),
    tradesOpened: Number(state.tradesOpened),
    realizedPnlUSDT: state.realizedPnlUSDT,
    killSwitchTripped: state.killSwitchTripped,
    killSwitchReason,
    pendingOrder,
  };
}

export function rollAutoTraderState(
  state: AutoTraderDailyState,
  now: Date,
): AutoTraderDailyState {
  const date = utcDate(now);
  if (state.date === date) return copyState(state);
  if (state.date > date) {
    throw new Error(
      `auto-trader state is future-dated (${state.date}); current UTC date is ${date}`,
    );
  }
  return {
    ...copyState(state),
    date,
    tradesOpened: 0,
    realizedPnlUSDT: 0,
  };
}

export function evaluateGate(
  state: AutoTraderDailyState,
  config: AutoTraderConfig,
  now: Date,
  killSwitchPresent: boolean,
): AutoTraderGateResult {
  if (killSwitchPresent) {
    return {
      allowed: false,
      reason: `auto-trader blocked: kill-switch file present at ${config.killSwitchPath}`,
    };
  }
  if (!config.enabled) {
    return {
      allowed: false,
      reason: 'auto-trader disabled: AUTO_TRADE_ENABLED must be exactly "true"',
    };
  }
  const current = rollAutoTraderState(state, now);
  if (current.killSwitchTripped) {
    return {
      allowed: false,
      reason: `auto-trader blocked: persistent kill switch tripped (${current.killSwitchReason ?? "reason unavailable"})`,
    };
  }
  if (current.pendingOrder) {
    return {
      allowed: false,
      reason: `auto-trader blocked: pending order ${current.pendingOrder.clientOid} is ${current.pendingOrder.status}; exchange reconciliation required`,
    };
  }
  if (current.tradesOpened >= config.maxTradesPerDay) {
    return {
      allowed: false,
      reason: `auto-trader blocked: daily trade-count cap ${config.maxTradesPerDay} reached`,
    };
  }
  if (current.realizedPnlUSDT <= -config.maxDailyLossUSDT) {
    return {
      allowed: false,
      reason: `auto-trader blocked: daily realized-trade-PnL cap ${config.maxDailyLossUSDT} USDT reached (fills plus USDT fees: ${current.realizedPnlUSDT} USDT)`,
    };
  }
  return { allowed: true };
}

export function readAutoTraderState(
  path: string,
  now: Date = new Date(),
): AutoTraderDailyState {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    if (isErrno(error, "ENOENT")) return createAutoTraderState(now);
    throw error;
  }
  try {
    return rollAutoTraderState(
      parseAutoTraderState(JSON.parse(text), path),
      now,
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`invalid auto-trader state at ${path}: ${detail}`);
  }
}

export function writeAutoTraderState(
  path: string,
  state: AutoTraderDailyState,
): void {
  const validated = parseAutoTraderState(state, path);
  const directory = dirname(path);
  mkdirSync(directory, { recursive: true });
  const temporaryPath = join(
    directory,
    `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`,
  );
  let created = false;
  let replaced = false;
  try {
    const fd = openSync(temporaryPath, "wx", 0o600);
    created = true;
    try {
      writeFileSync(fd, `${JSON.stringify(validated, null, 2)}\n`, "utf8");
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(temporaryPath, path);
    replaced = true;
    if (process.platform !== "win32") {
      const directoryFd = openSync(directory, "r");
      try {
        fsyncSync(directoryFd);
      } finally {
        closeSync(directoryFd);
      }
    }
  } finally {
    if (created && !replaced) {
      try {
        unlinkSync(temporaryPath);
      } catch (error) {
        if (!isErrno(error, "ENOENT")) throw error;
      }
    }
  }
}

export function reservePendingOrder(
  state: AutoTraderDailyState,
  reservation: Omit<PendingOrderReservation, "status" | "orderId">,
): AutoTraderDailyState {
  if (state.pendingOrder) {
    throw new Error(
      `pending order already exists: ${state.pendingOrder.clientOid}`,
    );
  }
  const pendingOrder = readPendingOrder(
    { ...reservation, status: "reserved" },
    "pending order",
  );
  if (!pendingOrder) throw new Error("pending order reservation is required");
  return { ...copyState(state), pendingOrder };
}

export function updatePendingOrder(
  state: AutoTraderDailyState,
  clientOid: string,
  update: {
    readonly status: Extract<PendingOrderStatus, "submitted" | "timeout">;
    readonly orderId?: string;
  },
): AutoTraderDailyState {
  if (!state.pendingOrder) {
    throw new Error("cannot update pending order: no reservation exists");
  }
  if (state.pendingOrder.clientOid !== clientOid) {
    throw new Error(
      `pending order ${state.pendingOrder.clientOid} does not match ${clientOid}`,
    );
  }
  const pendingOrder = readPendingOrder(
    {
      ...state.pendingOrder,
      status: update.status,
      ...(update.orderId === undefined ? {} : { orderId: update.orderId }),
    },
    "pending order",
  );
  if (!pendingOrder) throw new Error("pending order update is required");
  return { ...copyState(state), pendingOrder };
}

export function markPendingOrderTerminal(
  state: AutoTraderDailyState,
  clientOid: string,
  update: {
    readonly status: PendingOrderTerminalStatus;
    readonly orderId: string;
  },
): AutoTraderDailyState & {
  readonly pendingOrder: TerminalPendingOrderReservation;
} {
  if (!state.pendingOrder) {
    throw new Error(
      "cannot mark pending order terminal: no reservation exists",
    );
  }
  if (state.pendingOrder.clientOid !== clientOid) {
    throw new Error(
      `pending order ${state.pendingOrder.clientOid} does not match ${clientOid}`,
    );
  }
  const pendingOrder = readPendingOrder(
    { ...state.pendingOrder, ...update },
    "pending order",
  );
  if (!pendingOrder) throw new Error("terminal pending order is required");
  return {
    ...copyState(state),
    pendingOrder: pendingOrder as TerminalPendingOrderReservation,
  };
}

export function getTerminalPendingOrder(
  state: AutoTraderDailyState,
): TerminalPendingOrderReservation | null {
  const pendingOrder = readPendingOrder(state.pendingOrder, "pending order");
  if (
    !pendingOrder ||
    (pendingOrder.status !== "filled" && pendingOrder.status !== "cancelled")
  ) {
    return null;
  }
  return pendingOrder as TerminalPendingOrderReservation;
}

export function stagePendingOrderEvidence(
  state: AutoTraderDailyState,
  clientOid: string,
  evidence: PendingOrderEvidence,
): AutoTraderDailyState {
  if (!state.pendingOrder) {
    throw new Error("cannot stage evidence: no pending order exists");
  }
  if (state.pendingOrder.clientOid !== clientOid) {
    throw new Error(
      `pending order ${state.pendingOrder.clientOid} does not match ${clientOid}`,
    );
  }
  if (state.pendingOrder.evidence) {
    if (
      canonicalJson(state.pendingOrder.evidence) === canonicalJson(evidence)
    ) {
      return copyState(state);
    }
    throw new Error(
      `pending order ${clientOid} already has unacknowledged evidence`,
    );
  }
  const pendingOrder = readPendingOrder(
    { ...state.pendingOrder, evidence },
    "pending order",
  );
  if (!pendingOrder) throw new Error("pending order evidence is required");
  return { ...copyState(state), pendingOrder };
}

export function acknowledgePendingOrderEvidence(
  state: AutoTraderDailyState,
  clientOid: string,
  eventId: string,
): AutoTraderDailyState {
  if (!state.pendingOrder) {
    throw new Error("cannot acknowledge evidence: no pending order exists");
  }
  if (state.pendingOrder.clientOid !== clientOid) {
    throw new Error(
      `pending order ${state.pendingOrder.clientOid} does not match ${clientOid}`,
    );
  }
  const evidence = state.pendingOrder.evidence;
  if (!evidence) {
    throw new Error(`pending order ${clientOid} has no staged evidence`);
  }
  if (evidence.eventId !== eventId) {
    throw new Error(
      `pending evidence ${evidence.eventId} does not match ${eventId}`,
    );
  }
  if (
    state.pendingOrder.status === "filled" ||
    state.pendingOrder.status === "cancelled"
  ) {
    return { ...copyState(state), pendingOrder: null };
  }
  const pendingOrder = readPendingOrder(
    {
      clientOid: state.pendingOrder.clientOid,
      symbol: state.pendingOrder.symbol,
      reservedAt: state.pendingOrder.reservedAt,
      status: state.pendingOrder.status,
      ...(state.pendingOrder.orderId === undefined
        ? {}
        : { orderId: state.pendingOrder.orderId }),
    },
    "pending order",
  );
  if (!pendingOrder) throw new Error("pending order is required");
  return { ...copyState(state), pendingOrder };
}

export function clearPendingOrder(
  state: AutoTraderDailyState,
  clientOid: string,
): AutoTraderDailyState {
  if (!state.pendingOrder) {
    throw new Error("cannot clear pending order: no reservation exists");
  }
  if (state.pendingOrder.clientOid !== clientOid) {
    throw new Error(
      `pending order ${state.pendingOrder.clientOid} does not match ${clientOid}`,
    );
  }
  if (state.pendingOrder.evidence) {
    throw new Error(
      `pending order ${clientOid} has unacknowledged evidence ${state.pendingOrder.evidence.eventId}`,
    );
  }
  if (
    state.pendingOrder.status === "filled" ||
    state.pendingOrder.status === "cancelled"
  ) {
    throw new Error(
      `terminal pending order ${clientOid} requires evidence acknowledgement`,
    );
  }
  return { ...copyState(state), pendingOrder: null };
}

export function recordTradeOpened(
  state: AutoTraderDailyState,
): AutoTraderDailyState {
  const tradesOpened = state.tradesOpened + 1;
  if (!Number.isSafeInteger(tradesOpened)) {
    throw new Error("tradesOpened exceeds the safe integer range");
  }
  return { ...copyState(state), tradesOpened };
}

export function setReconciledTradeCount(
  state: AutoTraderDailyState,
  tradesOpened: number,
): AutoTraderDailyState {
  if (!Number.isSafeInteger(tradesOpened) || tradesOpened < 0) {
    throw new Error("tradesOpened must be a non-negative integer");
  }
  return {
    ...copyState(state),
    tradesOpened: Math.max(state.tradesOpened, tradesOpened),
  };
}

export function tripKillSwitch(
  state: AutoTraderDailyState,
  reason: string,
): AutoTraderDailyState {
  const killSwitchReason = readNonEmptyString(reason, "kill-switch reason");
  return {
    ...copyState(state),
    killSwitchTripped: true,
    killSwitchReason,
  };
}

export function clearPersistentKillSwitch(
  state: AutoTraderDailyState,
): AutoTraderDailyState {
  return {
    ...copyState(state),
    killSwitchTripped: false,
    killSwitchReason: null,
  };
}

export function setReconciledPnl(
  state: AutoTraderDailyState,
  realizedPnlUSDT: number,
  config: Pick<AutoTraderConfig, "maxDailyLossUSDT">,
): AutoTraderDailyState {
  if (!Number.isFinite(realizedPnlUSDT)) {
    throw new Error("realizedPnlUSDT must be a finite number");
  }
  if (
    !Number.isFinite(config.maxDailyLossUSDT) ||
    config.maxDailyLossUSDT <= 0
  ) {
    throw new Error("maxDailyLossUSDT must be a positive finite number");
  }
  const updated = { ...copyState(state), realizedPnlUSDT };
  if (state.killSwitchTripped || realizedPnlUSDT > -config.maxDailyLossUSDT) {
    return updated;
  }
  return tripKillSwitch(
    updated,
    `daily realized-trade-PnL cap ${config.maxDailyLossUSDT} USDT reached (fills plus USDT fees: ${realizedPnlUSDT} USDT)`,
  );
}

function parseLockRecord(value: unknown, path: string): AutoTraderLockRecord {
  const record = asRecord(value, path);
  assertKeys(record, ["ownerToken", "pid", "startedAt"], path);
  if (!Number.isSafeInteger(record.pid) || Number(record.pid) <= 0) {
    throw new Error(`${path}.pid must be a positive integer`);
  }
  return {
    ownerToken: readNonEmptyString(record.ownerToken, `${path}.ownerToken`),
    pid: Number(record.pid),
    startedAt: readCanonicalInstant(record.startedAt, `${path}.startedAt`),
  };
}

export function acquireAutoTraderLock(
  path: string,
  now: Date,
  maxAgeMs: number,
  owner: { readonly ownerToken?: string; readonly pid?: number } = {},
): AutoTraderLockResult {
  const startedAt = new Date(now.getTime()).toISOString();
  if (!Number.isSafeInteger(maxAgeMs) || maxAgeMs <= 0) {
    throw new Error("maxAgeMs must be a positive integer");
  }
  const record = parseLockRecord(
    {
      ownerToken: owner.ownerToken ?? randomUUID(),
      pid: owner.pid ?? process.pid,
      startedAt,
    },
    "auto-trader lock",
  );
  mkdirSync(dirname(path), { recursive: true });

  for (let attempt = 0; attempt < 4; attempt += 1) {
    let fd: number;
    try {
      fd = openSync(path, "wx", 0o600);
    } catch (error) {
      if (!isErrno(error, "EEXIST")) throw error;
      let observed: string;
      try {
        observed = readFileSync(path, "utf8");
      } catch (readError) {
        if (isErrno(readError, "ENOENT")) continue;
        throw readError;
      }
      let existing: AutoTraderLockRecord;
      try {
        existing = parseLockRecord(JSON.parse(observed), path);
      } catch (parseError) {
        const detail =
          parseError instanceof Error ? parseError.message : String(parseError);
        return {
          acquired: false,
          reason: `auto-trader lock is malformed and blocks execution: ${detail}`,
        };
      }
      const ageMs = now.getTime() - Date.parse(existing.startedAt);
      if (ageMs < maxAgeMs) {
        return {
          acquired: false,
          reason: `auto-trader lock is active for owner ${existing.ownerToken}`,
        };
      }
      return {
        acquired: false,
        reason: `auto-trader lock is stale for owner ${existing.ownerToken}; inspect the process, then perform manual removal of ${path} before retrying`,
      };
    }

    let complete = false;
    try {
      writeFileSync(fd, `${JSON.stringify(record)}\n`, "utf8");
      fsyncSync(fd);
      complete = true;
    } finally {
      closeSync(fd);
      if (!complete) {
        try {
          unlinkSync(path);
        } catch (error) {
          if (!isErrno(error, "ENOENT")) throw error;
        }
      }
    }
    return {
      acquired: true,
      recoveredStale: false,
      lock: { path, ...record },
    };
  }

  return {
    acquired: false,
    reason: "auto-trader lock changed repeatedly during acquisition",
  };
}

export function releaseAutoTraderLock(lock: AutoTraderLock): boolean {
  let observed: string;
  try {
    observed = readFileSync(lock.path, "utf8");
  } catch (error) {
    if (isErrno(error, "ENOENT")) return false;
    throw error;
  }
  let current: AutoTraderLockRecord;
  try {
    current = parseLockRecord(JSON.parse(observed), lock.path);
  } catch {
    return false;
  }
  if (current.ownerToken !== lock.ownerToken) return false;
  let confirmed: string;
  try {
    confirmed = readFileSync(lock.path, "utf8");
  } catch (error) {
    if (isErrno(error, "ENOENT")) return false;
    throw error;
  }
  if (confirmed !== observed) return false;
  try {
    unlinkSync(lock.path);
    return true;
  } catch (error) {
    if (isErrno(error, "ENOENT")) return false;
    throw error;
  }
}
