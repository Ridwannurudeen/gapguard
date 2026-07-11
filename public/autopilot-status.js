const ENTRY_STATES = [
  "armed",
  "dry_run",
  "disabled",
  "kill_switched",
  "cap_reached",
  "reconciling",
  "unknown",
];

const RUN_OUTCOMES = [
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
];

const ENTRY_LABELS = {
  armed: "Armed",
  dry_run: "Dry run",
  disabled: "Disabled",
  kill_switched: "Kill switch active",
  cap_reached: "Daily cap reached",
  reconciling: "Reconciling",
  unknown: "State unavailable",
};

const OUTCOME_LABELS = {
  disabled: "Disabled",
  blocked: "Blocked",
  no_signal: "No signal",
  rearmed: "Rearmed",
  dry_run: "Dry run",
  submitted: "Submitted",
  filled: "Filled",
  cancelled: "Cancelled",
  timeout: "Timed out",
  error: "Error",
};

const TOP_LEVEL_FIELDS = [
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
];

const CAP_FIELDS = [
  "date",
  "tradesOpened",
  "maxTradesPerDay",
  "dailyLossUsedUSDT",
  "maxDailyLossUSDT",
  "tradeCapReached",
  "dailyLossCapReached",
];

const RUN_FIELDS = ["startedAt", "completedAt", "outcome"];

function requireRecord(value, path) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${path} must be an object`);
  }
  return value;
}

function requireExactFields(value, fields, path) {
  const record = requireRecord(value, path);
  const allowed = new Set(fields);
  for (const key of Reflect.ownKeys(record)) {
    if (typeof key !== "string" || !allowed.has(key)) {
      throw new TypeError(`${path} contains unexpected field ${String(key)}`);
    }
  }
  for (const field of fields) {
    if (!Object.prototype.hasOwnProperty.call(record, field)) {
      throw new TypeError(`${path}.${field} is required`);
    }
  }
  return record;
}

function requireEnum(value, allowed, path) {
  if (typeof value !== "string" || !allowed.includes(value)) {
    throw new TypeError(`${path} is invalid`);
  }
  return value;
}

function requireBoolean(value, path) {
  if (typeof value !== "boolean") {
    throw new TypeError(`${path} must be a boolean`);
  }
  return value;
}

function requireNullableBoolean(value, path) {
  return value === null ? null : requireBoolean(value, path);
}

function requireTimestamp(value, path) {
  if (typeof value !== "string") {
    throw new TypeError(`${path} must be a canonical ISO timestamp`);
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== value) {
    throw new TypeError(`${path} must be a canonical ISO timestamp`);
  }
  return value;
}

function requireNullableDate(value, path) {
  if (value === null) return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new TypeError(`${path} must be a canonical UTC date or null`);
  }
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  if (
    !Number.isFinite(timestamp) ||
    new Date(timestamp).toISOString().slice(0, 10) !== value
  ) {
    throw new TypeError(`${path} must be a canonical UTC date or null`);
  }
  return value;
}

function requireNullableNonNegativeNumber(value, path) {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new TypeError(`${path} must be a non-negative finite number or null`);
  }
  return value;
}

function requireNullableCount(value, path) {
  if (value === null) return null;
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${path} must be a non-negative safe integer or null`);
  }
  return value;
}

function requireNullablePositiveCount(value, path) {
  const count = requireNullableCount(value, path);
  if (count === 0) {
    throw new TypeError(`${path} must be a positive safe integer or null`);
  }
  return count;
}

function requireNullablePositiveNumber(value, path) {
  const number = requireNullableNonNegativeNumber(value, path);
  if (number === 0) {
    throw new TypeError(`${path} must be a positive finite number or null`);
  }
  return number;
}

function parseRun(value, path) {
  const run = requireExactFields(value, RUN_FIELDS, path);
  const startedAt = requireTimestamp(run.startedAt, `${path}.startedAt`);
  const completedAt = requireTimestamp(run.completedAt, `${path}.completedAt`);
  if (Date.parse(completedAt) < Date.parse(startedAt)) {
    throw new TypeError(`${path}.completedAt cannot precede startedAt`);
  }
  return {
    startedAt,
    completedAt,
    outcome: requireEnum(run.outcome, RUN_OUTCOMES, `${path}.outcome`),
  };
}

function sameRun(left, right) {
  return (
    left.startedAt === right.startedAt &&
    left.completedAt === right.completedAt &&
    left.outcome === right.outcome
  );
}

function requireCoherentCap(used, maximum, reached, path) {
  if (used === null || maximum === null) {
    if (reached !== null) {
      throw new TypeError(`${path} must be null when its cap values are unknown`);
    }
    return;
  }
  if (reached !== used >= maximum) {
    throw new TypeError(`${path} contradicts its cap values`);
  }
}

function requireCoherentSnapshot(status) {
  const configValues = [
    status.caps.maxTradesPerDay,
    status.caps.maxDailyLossUSDT,
  ];
  const configKnown = configValues.every((value) => value !== null);
  if (!configKnown && configValues.some((value) => value !== null)) {
    throw new TypeError("autopilot status.caps has a partial configuration snapshot");
  }

  const stateValues = [
    status.caps.date,
    status.caps.tradesOpened,
    status.caps.dailyLossUsedUSDT,
    status.persistentKillTripped,
    status.pendingReconciliation,
    status.caps.tradeCapReached,
    status.caps.dailyLossCapReached,
  ];
  const stateKnown = stateValues.every((value) => value !== null);
  if (!stateKnown && stateValues.some((value) => value !== null)) {
    throw new TypeError("autopilot status has a partial daily-state snapshot");
  }
  if (stateKnown && !configKnown) {
    throw new TypeError("autopilot status has daily state without cap configuration");
  }
}

function expectedEntryState(status) {
  if (!status.enabled) return "disabled";
  if (status.killSwitchPresent === true) return "kill_switched";
  if (
    status.killSwitchPresent === null ||
    status.persistentKillTripped === null ||
    status.pendingReconciliation === null ||
    status.caps.tradeCapReached === null ||
    status.caps.dailyLossCapReached === null
  ) {
    return "unknown";
  }
  if (status.persistentKillTripped) return "kill_switched";
  if (status.pendingReconciliation) return "reconciling";
  if (status.caps.tradeCapReached || status.caps.dailyLossCapReached) {
    return "cap_reached";
  }
  return status.mode === "dry_run" ? "dry_run" : "armed";
}

function nowMilliseconds(now) {
  if (now instanceof Date) {
    const value = now.getTime();
    if (!Number.isFinite(value)) throw new TypeError("now must be a valid date");
    return value;
  }
  if (typeof now === "number" && Number.isFinite(now)) return now;
  if (typeof now === "string") return Date.parse(requireTimestamp(now, "now"));
  throw new TypeError("now must be a valid date, timestamp, or canonical ISO string");
}

export function parseAutopilotStatus(value) {
  const report = requireExactFields(value, TOP_LEVEL_FIELDS, "autopilot status");
  if (report.schemaVersion !== 1) {
    throw new TypeError("autopilot status.schemaVersion must be 1");
  }

  const caps = requireExactFields(report.caps, CAP_FIELDS, "autopilot status.caps");
  if (!Array.isArray(report.recentRuns)) {
    throw new TypeError("autopilot status.recentRuns must be an array");
  }
  if (report.recentRuns.length > 8) {
    throw new TypeError("autopilot status.recentRuns cannot exceed 8 entries");
  }

  const recentRuns = report.recentRuns.map((run, index) =>
    parseRun(run, `autopilot status.recentRuns[${index}]`),
  );
  const seenRuns = new Set();
  let previousCompletedAt = -Infinity;
  for (const [index, run] of recentRuns.entries()) {
    const key = `${run.startedAt}\u0000${run.completedAt}\u0000${run.outcome}`;
    if (seenRuns.has(key)) {
      throw new TypeError(`autopilot status.recentRuns[${index}] is duplicated`);
    }
    seenRuns.add(key);
    const completedAt = Date.parse(run.completedAt);
    if (completedAt < previousCompletedAt) {
      throw new TypeError("autopilot status.recentRuns must be chronological");
    }
    previousCompletedAt = completedAt;
  }

  const lastRun =
    report.lastRun === null
      ? null
      : parseRun(report.lastRun, "autopilot status.lastRun");
  const newestRun = recentRuns.at(-1) ?? null;
  if (
    (lastRun === null) !== (newestRun === null) ||
    (lastRun !== null && newestRun !== null && !sameRun(lastRun, newestRun))
  ) {
    throw new TypeError("autopilot status.lastRun must equal the newest recent run");
  }

  const parsed = {
    schemaVersion: 1,
    generatedAt: requireTimestamp(
      report.generatedAt,
      "autopilot status.generatedAt",
    ),
    mode: requireEnum(report.mode, ["live", "dry_run"], "autopilot status.mode"),
    entryState: requireEnum(
      report.entryState,
      ENTRY_STATES,
      "autopilot status.entryState",
    ),
    enabled: requireBoolean(report.enabled, "autopilot status.enabled"),
    killSwitchPresent: requireNullableBoolean(
      report.killSwitchPresent,
      "autopilot status.killSwitchPresent",
    ),
    persistentKillTripped: requireNullableBoolean(
      report.persistentKillTripped,
      "autopilot status.persistentKillTripped",
    ),
    pendingReconciliation: requireNullableBoolean(
      report.pendingReconciliation,
      "autopilot status.pendingReconciliation",
    ),
    cadenceMinutes: requireNullablePositiveCount(
      report.cadenceMinutes,
      "autopilot status.cadenceMinutes",
    ),
    lastRun,
    caps: {
      date: requireNullableDate(caps.date, "autopilot status.caps.date"),
      tradesOpened: requireNullableCount(
        caps.tradesOpened,
        "autopilot status.caps.tradesOpened",
      ),
      maxTradesPerDay: requireNullableCount(
        caps.maxTradesPerDay,
        "autopilot status.caps.maxTradesPerDay",
      ),
      dailyLossUsedUSDT: requireNullableNonNegativeNumber(
        caps.dailyLossUsedUSDT,
        "autopilot status.caps.dailyLossUsedUSDT",
      ),
      maxDailyLossUSDT: requireNullablePositiveNumber(
        caps.maxDailyLossUSDT,
        "autopilot status.caps.maxDailyLossUSDT",
      ),
      tradeCapReached: requireNullableBoolean(
        caps.tradeCapReached,
        "autopilot status.caps.tradeCapReached",
      ),
      dailyLossCapReached: requireNullableBoolean(
        caps.dailyLossCapReached,
        "autopilot status.caps.dailyLossCapReached",
      ),
    },
    recentRuns,
  };
  requireCoherentCap(
    parsed.caps.tradesOpened,
    parsed.caps.maxTradesPerDay,
    parsed.caps.tradeCapReached,
    "autopilot status.caps.tradeCapReached",
  );
  requireCoherentCap(
    parsed.caps.dailyLossUsedUSDT,
    parsed.caps.maxDailyLossUSDT,
    parsed.caps.dailyLossCapReached,
    "autopilot status.caps.dailyLossCapReached",
  );
  requireCoherentSnapshot(parsed);
  const expectedState = expectedEntryState(parsed);
  if (parsed.entryState !== expectedState) {
    throw new TypeError(
      `autopilot status.entryState must be ${expectedState} for this snapshot`,
    );
  }
  return parsed;
}

export function autopilotStatusFreshness(status, now = new Date()) {
  const generatedAt = requireTimestamp(status?.generatedAt, "status.generatedAt");
  const cadenceMinutes = requireNullablePositiveCount(
    status?.cadenceMinutes,
    "status.cadenceMinutes",
  );
  const ageMinutes = (nowMilliseconds(now) - Date.parse(generatedAt)) / 60_000;
  const maxAgeMinutes = cadenceMinutes === null ? 65 : cadenceMinutes * 2 + 5;
  return {
    fresh: ageMinutes >= -1 && ageMinutes <= maxAgeMinutes,
    ageMinutes,
    maxAgeMinutes,
  };
}

export function formatAutopilotRelativeTime(timestamp, now = new Date()) {
  const target = Date.parse(requireTimestamp(timestamp, "timestamp"));
  const differenceMinutes = (nowMilliseconds(now) - target) / 60_000;
  const future = differenceMinutes < 0;
  const absoluteMinutes = Math.abs(differenceMinutes);
  if (absoluteMinutes < 1) return "just now";

  let value;
  let unit;
  if (absoluteMinutes < 60) {
    value = Math.floor(absoluteMinutes);
    unit = "min";
  } else if (absoluteMinutes < 1_440) {
    value = Math.floor(absoluteMinutes / 60);
    unit = "hr";
  } else {
    value = Math.floor(absoluteMinutes / 1_440);
    unit = "day";
  }
  const label = `${value} ${unit}${unit === "day" && value !== 1 ? "s" : ""}`;
  return future ? `in ${label}` : `${label} ago`;
}

export function autopilotCapRatio(used, maximum) {
  if (used === null || maximum === null) return null;
  if (
    typeof used !== "number" ||
    !Number.isFinite(used) ||
    used < 0 ||
    typeof maximum !== "number" ||
    !Number.isFinite(maximum) ||
    maximum < 0
  ) {
    throw new TypeError("cap values must be non-negative finite numbers or null");
  }
  if (maximum === 0) return 1;
  return Math.min(1, used / maximum);
}

export function autopilotEntryLabel(entryState) {
  requireEnum(entryState, ENTRY_STATES, "entryState");
  return ENTRY_LABELS[entryState];
}

export function autopilotOutcomeLabel(outcome) {
  requireEnum(outcome, RUN_OUTCOMES, "outcome");
  return OUTCOME_LABELS[outcome];
}
