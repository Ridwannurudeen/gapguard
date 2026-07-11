import { randomUUID } from "node:crypto";
import {
  chmodSync,
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import {
  autoTraderKillSwitchPresent,
  runAutoTrader,
  type AutoTraderArgs,
  type AutoTraderDeps,
  type AutoTraderMode,
  type AutoTraderResult,
} from "./autoTrader";
import {
  parseAutoTraderConfig,
  parseAutoTraderState,
  rollAutoTraderState,
  type AutoTraderConfig,
  type AutoTraderDailyState,
} from "./autoTraderState";

export const AUTOPILOT_STATUS_HISTORY_LIMIT = 8;

export type AutopilotRunOutcome =
  | "disabled"
  | "blocked"
  | "no_signal"
  | "rearmed"
  | "dry_run"
  | "submitted"
  | "filled"
  | "cancelled"
  | "timeout"
  | "error";

export type AutopilotEntryState =
  | "armed"
  | "dry_run"
  | "disabled"
  | "kill_switched"
  | "cap_reached"
  | "reconciling"
  | "unknown";

export interface AutopilotRun {
  startedAt: string;
  completedAt: string;
  outcome: AutopilotRunOutcome;
}

export interface AutopilotStatusCaps {
  date: string | null;
  tradesOpened: number | null;
  maxTradesPerDay: number | null;
  dailyLossUsedUSDT: number | null;
  maxDailyLossUSDT: number | null;
  tradeCapReached: boolean | null;
  dailyLossCapReached: boolean | null;
}

export interface AutopilotStatusReport {
  schemaVersion: 1;
  generatedAt: string;
  mode: AutoTraderMode;
  entryState: AutopilotEntryState;
  enabled: boolean;
  killSwitchPresent: boolean | null;
  persistentKillTripped: boolean | null;
  pendingReconciliation: boolean | null;
  cadenceMinutes: number | null;
  lastRun: AutopilotRun | null;
  caps: AutopilotStatusCaps;
  recentRuns: AutopilotRun[];
}

export interface BuildAutopilotStatusOptions {
  mode: AutoTraderMode;
  env?: NodeJS.ProcessEnv;
  now?: Date;
  run?: AutopilotRun;
}

export interface AutopilotStatusIo {
  readText?: (path: string) => string;
  killSwitchPresent?: (path: string) => boolean;
}

export interface AutoTraderWithStatusDeps {
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
  run?: (
    args: AutoTraderArgs,
    deps: AutoTraderDeps,
  ) => Promise<AutoTraderResult>;
  publish?: (
    options: BuildAutopilotStatusOptions,
  ) => AutopilotStatusReport;
}

type UnknownRecord = Record<string, unknown>;

const RUN_OUTCOMES = new Set<AutopilotRunOutcome>([
  "disabled",
  "blocked",
  "no_signal",
  "rearmed",
  "dry_run",
  "submitted",
  "filled",
  "cancelled",
  "timeout",
  "error",
]);

const ENTRY_STATES = new Set<AutopilotEntryState>([
  "armed",
  "dry_run",
  "disabled",
  "kill_switched",
  "cap_reached",
  "reconciling",
  "unknown",
]);

function asRecord(value: unknown, path: string): UnknownRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${path} must be an object`);
  }
  return value as UnknownRecord;
}

function assertKeys(
  record: UnknownRecord,
  expected: readonly string[],
  path: string,
): void {
  const actual = Object.keys(record);
  const unexpected = actual.filter((key) => !expected.includes(key));
  const missing = expected.filter((key) => !actual.includes(key));
  if (unexpected.length > 0) {
    throw new Error(`${path} has unexpected field ${unexpected[0]}`);
  }
  if (missing.length > 0) {
    throw new Error(`${path} is missing field ${missing[0]}`);
  }
}

function readCanonicalInstant(value: unknown, path: string): string {
  if (typeof value !== "string") {
    throw new Error(`${path} must be a canonical ISO timestamp`);
  }
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new Error(`${path} must be a canonical ISO timestamp`);
  }
  return value;
}

function readNullableBoolean(value: unknown, path: string): boolean | null {
  if (value === null || typeof value === "boolean") return value;
  throw new Error(`${path} must be a boolean or null`);
}

function readNullableNumber(
  value: unknown,
  path: string,
  options: { integer?: boolean; positive?: boolean } = {},
): number | null {
  if (value === null) return null;
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    (options.integer === true && !Number.isSafeInteger(value)) ||
    (options.positive === true && value <= 0)
  ) {
    throw new Error(`${path} must be a valid non-negative number or null`);
  }
  return value;
}

function readNullableDate(value: unknown, path: string): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${path} must be a UTC date or null`);
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error(`${path} must be a valid UTC date or null`);
  }
  return value;
}

function parseRun(value: unknown, path: string): AutopilotRun {
  const record = asRecord(value, path);
  assertKeys(record, ["startedAt", "completedAt", "outcome"], path);
  const startedAt = readCanonicalInstant(record.startedAt, `${path}.startedAt`);
  const completedAt = readCanonicalInstant(
    record.completedAt,
    `${path}.completedAt`,
  );
  if (Date.parse(completedAt) < Date.parse(startedAt)) {
    throw new Error(`${path}.completedAt must not precede startedAt`);
  }
  if (!RUN_OUTCOMES.has(record.outcome as AutopilotRunOutcome)) {
    throw new Error(`${path}.outcome is invalid`);
  }
  return {
    startedAt,
    completedAt,
    outcome: record.outcome as AutopilotRunOutcome,
  };
}

function runKey(run: AutopilotRun): string {
  return `${run.startedAt}\u0000${run.completedAt}\u0000${run.outcome}`;
}

function equalRun(left: AutopilotRun, right: AutopilotRun): boolean {
  return runKey(left) === runKey(right);
}

function assertSnapshotCoherence(report: AutopilotStatusReport, path: string): void {
  const configValues = [
    report.caps.maxTradesPerDay,
    report.caps.maxDailyLossUSDT,
  ];
  const configKnown = configValues.every((value) => value !== null);
  if (!configKnown && configValues.some((value) => value !== null)) {
    throw new Error(`${path}.caps has a partial configuration snapshot`);
  }
  const stateValues = [
    report.caps.date,
    report.caps.tradesOpened,
    report.caps.dailyLossUsedUSDT,
    report.persistentKillTripped,
    report.pendingReconciliation,
    report.caps.tradeCapReached,
    report.caps.dailyLossCapReached,
  ];
  const stateKnown = stateValues.every((value) => value !== null);
  if (!stateKnown && stateValues.some((value) => value !== null)) {
    throw new Error(`${path} has a partial daily-state snapshot`);
  }
  if (stateKnown && !configKnown) {
    throw new Error(`${path} has daily state without cap configuration`);
  }
  if (stateKnown && configKnown) {
    const expectedTradeCap =
      Number(report.caps.tradesOpened) >=
      Number(report.caps.maxTradesPerDay);
    const expectedDailyLossCap =
      Number(report.caps.dailyLossUsedUSDT) >=
      Number(report.caps.maxDailyLossUSDT);
    if (report.caps.tradeCapReached !== expectedTradeCap) {
      throw new Error(`${path}.caps.tradeCapReached contradicts cap values`);
    }
    if (report.caps.dailyLossCapReached !== expectedDailyLossCap) {
      throw new Error(
        `${path}.caps.dailyLossCapReached contradicts cap values`,
      );
    }
  }

  let expectedEntryState: AutopilotEntryState;
  if (!report.enabled) {
    expectedEntryState = "disabled";
  } else if (report.killSwitchPresent === true) {
    expectedEntryState = "kill_switched";
  } else if (
    report.killSwitchPresent === null ||
    !configKnown ||
    !stateKnown
  ) {
    expectedEntryState = "unknown";
  } else if (report.persistentKillTripped === true) {
    expectedEntryState = "kill_switched";
  } else if (report.pendingReconciliation === true) {
    expectedEntryState = "reconciling";
  } else if (
    report.caps.tradeCapReached === true ||
    report.caps.dailyLossCapReached === true
  ) {
    expectedEntryState = "cap_reached";
  } else {
    expectedEntryState = report.mode === "dry_run" ? "dry_run" : "armed";
  }
  if (report.entryState !== expectedEntryState) {
    throw new Error(
      `${path}.entryState contradicts the sanitized gate snapshot`,
    );
  }
}

export function parseAutopilotStatusReport(
  value: unknown,
  path = "autopilot status",
): AutopilotStatusReport {
  const record = asRecord(value, path);
  assertKeys(
    record,
    [
      "schemaVersion",
      "generatedAt",
      "mode",
      "entryState",
      "enabled",
      "killSwitchPresent",
      "persistentKillTripped",
      "pendingReconciliation",
      "cadenceMinutes",
      "lastRun",
      "caps",
      "recentRuns",
    ],
    path,
  );
  if (record.schemaVersion !== 1) {
    throw new Error(`${path}.schemaVersion must be 1`);
  }
  if (record.mode !== "live" && record.mode !== "dry_run") {
    throw new Error(`${path}.mode must be live or dry_run`);
  }
  if (!ENTRY_STATES.has(record.entryState as AutopilotEntryState)) {
    throw new Error(`${path}.entryState is invalid`);
  }
  if (typeof record.enabled !== "boolean") {
    throw new Error(`${path}.enabled must be a boolean`);
  }
  const capsRecord = asRecord(record.caps, `${path}.caps`);
  assertKeys(
    capsRecord,
    [
      "date",
      "tradesOpened",
      "maxTradesPerDay",
      "dailyLossUsedUSDT",
      "maxDailyLossUSDT",
      "tradeCapReached",
      "dailyLossCapReached",
    ],
    `${path}.caps`,
  );
  if (!Array.isArray(record.recentRuns)) {
    throw new Error(`${path}.recentRuns must be an array`);
  }
  if (record.recentRuns.length > AUTOPILOT_STATUS_HISTORY_LIMIT) {
    throw new Error(
      `${path}.recentRuns exceeds ${AUTOPILOT_STATUS_HISTORY_LIMIT} entries`,
    );
  }
  const recentRuns = record.recentRuns.map((run, index) =>
    parseRun(run, `${path}.recentRuns[${index}]`),
  );
  const keys = new Set(recentRuns.map(runKey));
  if (keys.size !== recentRuns.length) {
    throw new Error(`${path}.recentRuns contains duplicates`);
  }
  for (let index = 1; index < recentRuns.length; index += 1) {
    if (
      Date.parse(recentRuns[index].completedAt) <
      Date.parse(recentRuns[index - 1].completedAt)
    ) {
      throw new Error(`${path}.recentRuns must be chronological`);
    }
  }
  const lastRun =
    record.lastRun === null
      ? null
      : parseRun(record.lastRun, `${path}.lastRun`);
  const newest = recentRuns.at(-1) ?? null;
  if (
    (lastRun === null && newest !== null) ||
    (lastRun !== null && (newest === null || !equalRun(lastRun, newest)))
  ) {
    throw new Error(`${path}.lastRun must match the newest recent run`);
  }
  const report: AutopilotStatusReport = {
    schemaVersion: 1,
    generatedAt: readCanonicalInstant(
      record.generatedAt,
      `${path}.generatedAt`,
    ),
    mode: record.mode,
    entryState: record.entryState as AutopilotEntryState,
    enabled: record.enabled,
    killSwitchPresent: readNullableBoolean(
      record.killSwitchPresent,
      `${path}.killSwitchPresent`,
    ),
    persistentKillTripped: readNullableBoolean(
      record.persistentKillTripped,
      `${path}.persistentKillTripped`,
    ),
    pendingReconciliation: readNullableBoolean(
      record.pendingReconciliation,
      `${path}.pendingReconciliation`,
    ),
    cadenceMinutes: readNullableNumber(
      record.cadenceMinutes,
      `${path}.cadenceMinutes`,
      { integer: true, positive: true },
    ),
    lastRun,
    caps: {
      date: readNullableDate(capsRecord.date, `${path}.caps.date`),
      tradesOpened: readNullableNumber(
        capsRecord.tradesOpened,
        `${path}.caps.tradesOpened`,
        { integer: true },
      ),
      maxTradesPerDay: readNullableNumber(
        capsRecord.maxTradesPerDay,
        `${path}.caps.maxTradesPerDay`,
        { integer: true },
      ),
      dailyLossUsedUSDT: readNullableNumber(
        capsRecord.dailyLossUsedUSDT,
        `${path}.caps.dailyLossUsedUSDT`,
      ),
      maxDailyLossUSDT: readNullableNumber(
        capsRecord.maxDailyLossUSDT,
        `${path}.caps.maxDailyLossUSDT`,
        { positive: true },
      ),
      tradeCapReached: readNullableBoolean(
        capsRecord.tradeCapReached,
        `${path}.caps.tradeCapReached`,
      ),
      dailyLossCapReached: readNullableBoolean(
        capsRecord.dailyLossCapReached,
        `${path}.caps.dailyLossCapReached`,
      ),
    },
    recentRuns,
  };
  assertSnapshotCoherence(report, path);
  return report;
}

function envPath(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: string,
): string | null {
  const value = env[name] ?? fallback;
  return value.trim().length > 0 ? resolve(value) : null;
}

export function resolveAutopilotStatusPath(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const path = envPath(
    env,
    "AUTO_TRADE_STATUS_PATH",
    "state/autopilot-status.json",
  );
  if (!path) throw new Error("AUTO_TRADE_STATUS_PATH must be a non-empty path");
  return path;
}

function cadenceFromEnv(env: NodeJS.ProcessEnv): number | null {
  const raw = env.AUTO_TRADE_CADENCE_MINUTES;
  if (raw === undefined) return 30;
  const cadence = Number(raw);
  return Number.isSafeInteger(cadence) && cadence > 0 ? cadence : null;
}

function readConfig(env: NodeJS.ProcessEnv): AutoTraderConfig | null {
  try {
    return parseAutoTraderConfig(env);
  } catch {
    return null;
  }
}

function statePath(
  mode: AutoTraderMode,
  env: NodeJS.ProcessEnv,
  config: AutoTraderConfig | null,
): string | null {
  if (!config) return null;
  return mode === "live"
    ? resolve(config.statePath)
    : envPath(
        env,
        "AUTO_TRADE_DRY_RUN_STATE_PATH",
        "state/auto-trader-dry-run.json",
      );
}

function readState(
  path: string | null,
  now: Date,
  readText: (path: string) => string,
): AutoTraderDailyState | null {
  if (!path) return null;
  try {
    return rollAutoTraderState(
      parseAutoTraderState(JSON.parse(readText(path)), path),
      now,
    );
  } catch {
    return null;
  }
}

function readKillSwitch(
  env: NodeJS.ProcessEnv,
  config: AutoTraderConfig | null,
  present: (path: string) => boolean,
): boolean | null {
  const path = config
    ? resolve(config.killSwitchPath)
    : envPath(
        env,
        "AUTO_TRADE_KILL_SWITCH_PATH",
        "state/AUTO_TRADE_KILL",
      );
  if (!path) return null;
  try {
    return present(path);
  } catch {
    return null;
  }
}

function readPreviousStatus(
  path: string,
  readText: (path: string) => string,
): AutopilotStatusReport | null {
  try {
    return parseAutopilotStatusReport(JSON.parse(readText(path)), path);
  } catch {
    return null;
  }
}

function mergeRuns(
  previous: readonly AutopilotRun[],
  current?: AutopilotRun,
): AutopilotRun[] {
  const byKey = new Map<string, AutopilotRun>();
  for (const run of current ? [...previous, parseRun(current, "run")] : previous) {
    byKey.set(runKey(run), run);
  }
  return [...byKey.values()]
    .sort(
      (left, right) =>
        Date.parse(left.completedAt) - Date.parse(right.completedAt) ||
        Date.parse(left.startedAt) - Date.parse(right.startedAt) ||
        left.outcome.localeCompare(right.outcome),
    )
    .slice(-AUTOPILOT_STATUS_HISTORY_LIMIT);
}

function unknownCaps(config: AutoTraderConfig | null): AutopilotStatusCaps {
  return {
    date: null,
    tradesOpened: null,
    maxTradesPerDay: config?.maxTradesPerDay ?? null,
    dailyLossUsedUSDT: null,
    maxDailyLossUSDT: config?.maxDailyLossUSDT ?? null,
    tradeCapReached: null,
    dailyLossCapReached: null,
  };
}

function statusCaps(
  state: AutoTraderDailyState | null,
  config: AutoTraderConfig | null,
): AutopilotStatusCaps {
  if (!state || !config) return unknownCaps(config);
  const dailyLossUsedUSDT = Math.max(0, -state.realizedPnlUSDT);
  return {
    date: state.date,
    tradesOpened: state.tradesOpened,
    maxTradesPerDay: config.maxTradesPerDay,
    dailyLossUsedUSDT,
    maxDailyLossUSDT: config.maxDailyLossUSDT,
    tradeCapReached: state.tradesOpened >= config.maxTradesPerDay,
    dailyLossCapReached: dailyLossUsedUSDT >= config.maxDailyLossUSDT,
  };
}

function entryState(input: {
  mode: AutoTraderMode;
  enabled: boolean;
  config: AutoTraderConfig | null;
  state: AutoTraderDailyState | null;
  killSwitchPresent: boolean | null;
  caps: AutopilotStatusCaps;
}): AutopilotEntryState {
  if (!input.enabled) return "disabled";
  if (input.killSwitchPresent === true) return "kill_switched";
  if (
    input.killSwitchPresent === null ||
    input.config === null ||
    input.state === null
  ) {
    return "unknown";
  }
  if (input.state.killSwitchTripped) return "kill_switched";
  if (input.state.pendingOrder) return "reconciling";
  if (
    input.caps.tradeCapReached === true ||
    input.caps.dailyLossCapReached === true
  ) {
    return "cap_reached";
  }
  return input.mode === "dry_run" ? "dry_run" : "armed";
}

export function buildAutopilotStatus(
  options: BuildAutopilotStatusOptions,
  io: AutopilotStatusIo = {},
): AutopilotStatusReport {
  const env = options.env ?? process.env;
  const now = options.now ?? new Date();
  const generatedAt = readCanonicalInstant(
    now.toISOString(),
    "generatedAt",
  );
  const readText = io.readText ?? ((path: string) => readFileSync(path, "utf8"));
  const statusPath = resolveAutopilotStatusPath(env);
  const previous = readPreviousStatus(statusPath, readText);
  const config = readConfig(env);
  const state = readState(statePath(options.mode, env, config), now, readText);
  const killSwitchPresent = readKillSwitch(
    env,
    config,
    io.killSwitchPresent ?? autoTraderKillSwitchPresent,
  );
  const enabled = env.AUTO_TRADE_ENABLED === "true";
  const caps = statusCaps(state, config);
  const recentRuns = mergeRuns(previous?.recentRuns ?? [], options.run);
  const report: AutopilotStatusReport = {
    schemaVersion: 1,
    generatedAt,
    mode: options.mode,
    entryState: entryState({
      mode: options.mode,
      enabled,
      config,
      state,
      killSwitchPresent,
      caps,
    }),
    enabled,
    killSwitchPresent,
    persistentKillTripped: state?.killSwitchTripped ?? null,
    pendingReconciliation: state ? state.pendingOrder !== null : null,
    cadenceMinutes: cadenceFromEnv(env),
    lastRun: recentRuns.at(-1) ?? null,
    caps,
    recentRuns,
  };
  return parseAutopilotStatusReport(report);
}

function isErrno(error: unknown, code: string): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === code
  );
}

export function writeAutopilotStatus(
  path: string,
  value: unknown,
): AutopilotStatusReport {
  const report = parseAutopilotStatusReport(value, path);
  const directory = dirname(path);
  mkdirSync(directory, { recursive: true });
  const temporaryPath = join(
    directory,
    `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`,
  );
  let created = false;
  let replaced = false;
  try {
    const fd = openSync(temporaryPath, "wx", 0o640);
    created = true;
    try {
      writeFileSync(fd, `${JSON.stringify(report, null, 2)}\n`, "utf8");
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    chmodSync(temporaryPath, 0o640);
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
  return report;
}

export function publishAutopilotStatus(
  options: BuildAutopilotStatusOptions,
  io: AutopilotStatusIo = {},
): AutopilotStatusReport {
  const report = buildAutopilotStatus(options, io);
  return writeAutopilotStatus(
    resolveAutopilotStatusPath(options.env ?? process.env),
    report,
  );
}

function validClock(clock: () => Date, path: string): Date {
  const value = clock();
  if (!Number.isFinite(value.getTime())) {
    throw new Error(`${path} must be a valid Date`);
  }
  return value;
}

function outcomeFromResult(result: AutoTraderResult): AutopilotRunOutcome {
  if (!RUN_OUTCOMES.has(result.status)) {
    throw new Error("auto-trader returned an unsupported status");
  }
  return result.status;
}

export async function runAutoTraderWithStatus(
  args: AutoTraderArgs,
  deps: AutoTraderWithStatusDeps = {},
): Promise<AutoTraderResult> {
  const env = deps.env ?? process.env;
  const clock = deps.now ?? (() => new Date());
  const publish =
    deps.publish ??
    ((options: BuildAutopilotStatusOptions) => publishAutopilotStatus(options));
  const run = deps.run ?? runAutoTrader;
  const startedAt = validClock(clock, "run start");
  let result: AutoTraderResult;
  try {
    result = await run(args, { env });
  } catch (runError) {
    const completedAt = validClock(clock, "run failure");
    try {
      publish({
        mode: args.mode,
        env,
        now: completedAt,
        run: {
          startedAt: startedAt.toISOString(),
          completedAt: completedAt.toISOString(),
          outcome: "error",
        },
      });
    } catch (publishError) {
      throw new AggregateError(
        [runError, publishError],
        "auto-trader run and status publication both failed",
      );
    }
    throw runError;
  }
  const completedAt = validClock(clock, "run completion");
  publish({
    mode: args.mode,
    env,
    now: completedAt,
    run: {
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      outcome: outcomeFromResult(result),
    },
  });
  return result;
}
