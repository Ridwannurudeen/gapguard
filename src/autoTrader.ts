import { statSync } from "node:fs";
import { resolve } from "node:path";
import { issuePassport, type AgentPassport } from "./agentArena";
import {
  appendAutoTraderEvidence,
  buildReconciledOrderEvidence,
  prepareLiveAutoTraderEvidence,
  replayPendingOrderEvidence,
  type AutoTraderEvidenceOptions,
  type AutoTraderEvidenceRow,
  type AutoTraderEvidenceStatus,
} from "./autoTraderEvidence";
import {
  isOpeningTradeSide,
  readAutoTraderExchangeSnapshot,
  type AutoTraderExchangeOrder,
  type AutoTraderExchangeSnapshot,
} from "./autoTraderExchange";
import {
  acquireAutoTraderLock,
  acknowledgePendingOrderEvidence,
  clearPendingOrder,
  clearPersistentKillSwitch,
  createAutoTraderState,
  evaluateGate,
  getTerminalPendingOrder,
  markPendingOrderTerminal,
  parseAutoTraderConfig,
  readAutoTraderState,
  recordTradeOpened,
  releaseAutoTraderLock,
  reservePendingOrder,
  setReconciledPnl,
  setReconciledTradeCount,
  stagePendingOrderEvidence,
  tripKillSwitch,
  updatePendingOrder,
  writeAutoTraderState,
  type AutoTraderConfig,
  type AutoTraderDailyState,
} from "./autoTraderState";
import {
  ARENA_DEFAULT_BRACKET_PCT,
  buildArenaScenarioFromRwaMarket,
  type ArenaScenario,
} from "./arenaScenario";
import {
  type AttestedArenaConfig,
  validateAttestedArenaPreflight,
} from "./arena-chain";
import {
  computeBracketPrices,
  extractOrderId,
  placeFuturesOrder,
  BrokerPostSubmissionError,
  type BrokerConfig,
  type BrokerMode,
  type BrokerResult,
  type FuturesOrderIntent,
  type FuturesSide,
} from "./liveStockBroker";
import {
  fetchRwaMarketReport,
  suggestedOrderSize,
  type RwaMarketReport,
  type RwaMarketRow,
} from "./rwa-market";
import { WIDE_SPREAD_BPS } from "./proxyReturn";

export type AutoTraderMode = Extract<BrokerMode, "dry_run" | "live">;

export interface AutoTraderArgs {
  mode: AutoTraderMode;
  rearmPersistentKill?: boolean;
}

export interface AutoTradeCandidate {
  row: RwaMarketRow;
  scenario: ArenaScenario;
  passport: AgentPassport;
  side: Extract<FuturesSide, "open_long" | "open_short">;
  size: number;
  referencePrice: number;
  notionalUSDT: number;
  riskBudgetUSDT: number;
}

export interface AutoTradeSelection {
  candidate: AutoTradeCandidate | null;
  reason: string;
}

export interface AutoTraderResult {
  mode: AutoTraderMode;
  status:
    | "disabled"
    | "blocked"
    | "no_signal"
    | "rearmed"
    | AutoTraderEvidenceStatus;
  reason: string;
  symbol?: string;
  clientOid?: string;
  brokerResult?: BrokerResult;
}

export type AutoTraderPlaceOrder = (
  intent: FuturesOrderIntent,
  config: BrokerConfig,
) => Promise<BrokerResult>;

export interface AutoTraderDeps {
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
  fetchMarket?: () => Promise<RwaMarketReport>;
  buildScenario?: typeof buildArenaScenarioFromRwaMarket;
  readExchange?: (input: {
    pnlSince: number;
    orderHistorySince: number;
  }) => Promise<AutoTraderExchangeSnapshot>;
  place?: AutoTraderPlaceOrder;
  killSwitchPresent?: (path: string) => boolean;
  preflightEvidence?: (config: AttestedArenaConfig, now: Date) => unknown;
  recordEvidence?: (
    row: AutoTraderEvidenceRow,
    options: AutoTraderEvidenceOptions,
  ) => unknown;
}

interface AutoTraderRuntimeConfig {
  gate: AutoTraderConfig;
  maxNotionalUSDT: number;
  dryRunEquityUSDT: number;
  maxMarketAgeMs: number;
  timeoutMs: number;
  pollAttempts: number;
  pollIntervalMs: number;
  evidence: AutoTraderEvidenceOptions;
  attestedArena: AttestedArenaConfig;
}

function valueAfter(argv: string[], index: number, flag: string): string {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

export function parseAutoTraderArgs(argv: string[]): AutoTraderArgs {
  let mode: AutoTraderMode = "dry_run";
  let rearmPersistentKill = false;
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--mode") {
      const value = valueAfter(argv, index, flag);
      if (value !== "dry_run" && value !== "live") {
        throw new Error("--mode must be dry_run or live");
      }
      mode = value;
      index += 1;
    } else if (flag === "--rearm-persistent-kill") {
      rearmPersistentKill = true;
    } else {
      throw new Error(`unknown argument: ${flag}`);
    }
  }
  if (rearmPersistentKill && mode !== "live") {
    throw new Error("--rearm-persistent-kill requires --mode live");
  }
  return { mode, ...(rearmPersistentKill ? { rearmPersistentKill } : {}) };
}

function envNumber(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  options: { integer?: boolean; allowZero?: boolean } = {},
): number {
  const raw = env[name];
  if (raw !== undefined && raw.trim().length === 0) {
    throw new Error(`${name} has an invalid value`);
  }
  const value = raw === undefined ? fallback : Number(raw);
  const minimumOk = options.allowZero === true ? value >= 0 : value > 0;
  if (
    !Number.isFinite(value) ||
    !minimumOk ||
    (options.integer === true && !Number.isSafeInteger(value))
  ) {
    throw new Error(`${name} has an invalid value`);
  }
  return value;
}

function envPath(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: string,
): string {
  const value = env[name] ?? fallback;
  if (value.trim().length === 0) throw new Error(`${name} must not be empty`);
  return resolve(value);
}

function isErrno(error: unknown, code: string): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === code
  );
}

export function autoTraderKillSwitchPresent(path: string): boolean {
  try {
    statSync(path);
    return true;
  } catch (error) {
    if (isErrno(error, "ENOENT")) return false;
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `unable to verify kill-switch absence at ${path}; execution blocked: ${detail}`,
    );
  }
}

function runtimeConfig(
  mode: AutoTraderMode,
  env: NodeJS.ProcessEnv,
): AutoTraderRuntimeConfig {
  const gate = parseAutoTraderConfig(env);
  const attestedArena: AttestedArenaConfig = {
    chainPath: envPath(
      env,
      "AUTO_TRADE_ARENA_CHAIN_PATH",
      "public/arena-chain.jsonl",
    ),
    attestationPath: envPath(
      env,
      "AUTO_TRADE_ARENA_ATTESTATION_PATH",
      "public/arena-attestation.json",
    ),
    publicKeyPath: envPath(
      env,
      "AUTO_TRADE_ARENA_PUBLIC_KEY_PATH",
      "public/arena-pubkey.pem",
    ),
    lockPath: envPath(
      env,
      "AUTO_TRADE_ARENA_LOCK_PATH",
      "state/arena-chain.lock",
    ),
    lockMaxAgeMs: gate.lockMaxAgeMs,
    env,
    model: "GapGuard autonomous Quorum execution",
  };
  return {
    gate: {
      ...gate,
      statePath:
        mode === "live"
          ? resolve(gate.statePath)
          : envPath(
              env,
              "AUTO_TRADE_DRY_RUN_STATE_PATH",
              "state/auto-trader-dry-run.json",
            ),
      killSwitchPath: resolve(gate.killSwitchPath),
      lockPath:
        mode === "live"
          ? resolve(gate.lockPath)
          : envPath(
              env,
              "AUTO_TRADE_DRY_RUN_LOCK_PATH",
              "state/auto-trader-dry-run.lock",
            ),
    },
    maxNotionalUSDT: envNumber(env, "LIVE_MAX_NOTIONAL_USDT", 20),
    dryRunEquityUSDT: envNumber(env, "AUTO_TRADE_DRY_RUN_EQUITY_USDT", 20),
    maxMarketAgeMs: envNumber(env, "AUTO_TRADE_MAX_MARKET_AGE_MS", 300_000, {
      integer: true,
    }),
    timeoutMs: envNumber(env, "BITGET_BROKER_TIMEOUT_MS", 30_000, {
      integer: true,
    }),
    pollAttempts: envNumber(env, "BITGET_BROKER_POLL_ATTEMPTS", 10, {
      integer: true,
      allowZero: true,
    }),
    pollIntervalMs: envNumber(env, "BITGET_BROKER_POLL_INTERVAL_MS", 1_000, {
      integer: true,
      allowZero: true,
    }),
    evidence: {
      journalPath: envPath(
        env,
        "AUTO_TRADE_JOURNAL_PATH",
        mode === "live"
          ? "artifacts/live-trades.jsonl"
          : "artifacts/auto-trader-dry-run.jsonl",
      ),
      ...(mode === "live" ? { attestedArena } : {}),
      agentId: "quorum-rwa-desk",
    },
    attestedArena,
  };
}

function timestampMs(value: string | null): number | null {
  if (value === null || value.length === 0) return null;
  const parsed = /^\d+$/.test(value) ? Number(value) : Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function freshnessAgeMs(timestamp: number, now: Date): number | null {
  const age = now.getTime() - timestamp;
  return age >= -60_000 ? age : null;
}

function sideFromScenario(
  scenario: ArenaScenario,
): AutoTradeCandidate["side"] | null {
  if (scenario.quorumDecision.winningVote === "long") return "open_long";
  if (scenario.quorumDecision.winningVote === "short") return "open_short";
  return null;
}

export function selectAutoTradeCandidate(input: {
  report: RwaMarketReport;
  now: Date;
  equityUSDT: number;
  maxNotionalUSDT: number;
  maxPositionPct: number;
  maxMarketAgeMs: number;
  buildScenario?: typeof buildArenaScenarioFromRwaMarket;
}): AutoTradeSelection {
  const generatedAt = Date.parse(input.report.generatedAt);
  const reportAge = freshnessAgeMs(generatedAt, input.now);
  if (
    !Number.isFinite(generatedAt) ||
    reportAge === null ||
    reportAge > input.maxMarketAgeMs
  ) {
    return { candidate: null, reason: "RWA market report is stale or invalid" };
  }
  if (!Number.isFinite(input.equityUSDT) || input.equityUSDT <= 0) {
    return { candidate: null, reason: "account equity is not positive" };
  }

  const buildScenario = input.buildScenario ?? buildArenaScenarioFromRwaMarket;
  const candidates: AutoTradeCandidate[] = [];
  let actionableSignals = 0;
  for (const row of input.report.rows) {
    if (
      !row.liveReady ||
      row.lastPrice === null ||
      row.bidPrice === null ||
      row.askPrice === null ||
      row.bidPrice <= 0 ||
      row.askPrice < row.bidPrice
    ) {
      continue;
    }
    const quoteMid = (row.bidPrice + row.askPrice) / 2;
    const quoteSpreadBps =
      quoteMid > 0
        ? ((row.askPrice - row.bidPrice) / quoteMid) * 10_000
        : Number.POSITIVE_INFINITY;
    if (
      row.spreadBps === null ||
      row.spreadBps < 0 ||
      row.spreadBps >= WIDE_SPREAD_BPS ||
      !Number.isFinite(quoteSpreadBps) ||
      quoteSpreadBps >= WIDE_SPREAD_BPS
    ) {
      continue;
    }
    const tickerAt = timestampMs(row.ts);
    const tickerAge =
      tickerAt === null ? null : freshnessAgeMs(tickerAt, input.now);
    if (tickerAge === null || tickerAge > input.maxMarketAgeMs) {
      continue;
    }
    const scenario = buildScenario(
      input.report,
      row.symbol,
      row.lastPrice,
      Math.min(input.maxNotionalUSDT, input.report.maxNotionalUSDT),
      {
        rwaFreshness: {
          path: input.report.source.baseUrl,
          status: "fresh",
          generatedAt: input.report.generatedAt,
          ageMinutes: Number((reportAge / 60_000).toFixed(1)),
          maxAgeMinutes: input.maxMarketAgeMs / 60_000,
        },
      },
    );
    const decision = scenario.quorumDecision;
    const side = sideFromScenario(scenario);
    if (
      decision.vetoed ||
      side === null ||
      decision.positionMultiplier <= 0 ||
      scenario.perception.dislocation.confidence <= 0 ||
      !scenario.quorumMandateCheck.ok
    ) {
      continue;
    }
    actionableSignals += 1;
    const passport = issuePassport(scenario.quorumCandidate);
    if (passport.grade !== "LICENSED") continue;
    const referencePrice = side === "open_long" ? row.askPrice : row.bidPrice;
    const size = suggestedOrderSize(
      row.minTradeNum,
      row.minTradeUSDT,
      row.sizeMultiplier,
      referencePrice,
    );
    if (
      size === null ||
      (row.maxMarketOrderQty !== null && size > row.maxMarketOrderQty)
    ) {
      continue;
    }
    const notionalUSDT = size * referencePrice;
    const riskBudgetUSDT = Math.min(
      input.maxNotionalUSDT,
      input.report.maxNotionalUSDT,
      passport.license.maxNotionalUSDT,
      input.equityUSDT * input.maxPositionPct * decision.positionMultiplier,
    );
    if (notionalUSDT > riskBudgetUSDT + Number.EPSILON) continue;
    candidates.push({
      row,
      scenario,
      passport,
      side,
      size,
      referencePrice,
      notionalUSDT,
      riskBudgetUSDT,
    });
  }

  candidates.sort((left, right) => {
    const consensus =
      right.scenario.quorumDecision.consensusScore -
      left.scenario.quorumDecision.consensusScore;
    if (consensus !== 0) return consensus;
    const confidence =
      right.scenario.perception.dislocation.confidence -
      left.scenario.perception.dislocation.confidence;
    if (confidence !== 0) return confidence;
    return right.row.quoteVolumeUSDT - left.row.quoteVolumeUSDT;
  });
  if (candidates[0]) {
    return {
      candidate: candidates[0],
      reason: "actionable candidate selected",
    };
  }
  return {
    candidate: null,
    reason:
      actionableSignals > 0
        ? "no actionable candidate fits the equity risk budget and exchange minimum"
        : "no actionable Quorum signal",
  };
}

function matchingOrders(
  orders: AutoTraderExchangeOrder[],
  state: AutoTraderDailyState,
): AutoTraderExchangeOrder[] {
  const pending = state.pendingOrder;
  if (!pending) return [];
  return orders.filter(
    (order) =>
      order.clientOid === pending.clientOid ||
      (pending.orderId !== undefined && order.orderId === pending.orderId),
  );
}

export function reconcileAutoTraderState(
  state: AutoTraderDailyState,
  snapshot: AutoTraderExchangeSnapshot,
  config: AutoTraderConfig,
): AutoTraderDailyState {
  let next = setReconciledPnl(state, snapshot.realizedPnlUSDT, config);
  const dayStart = Date.parse(`${state.date}T00:00:00.000Z`);
  const dayEnd = dayStart + 24 * 60 * 60 * 1000;
  const autoOpenClientOids = new Set(
    snapshot.recentOrders
      .filter(
        (order) =>
          order.clientOid?.startsWith("ggauto-") === true &&
          order.status.toLowerCase() === "filled" &&
          isOpeningTradeSide(order.tradeSide) &&
          order.createdAt >= dayStart &&
          order.createdAt < dayEnd,
      )
      .map((order) => order.clientOid as string),
  );
  next = setReconciledTradeCount(next, autoOpenClientOids.size);
  if (!next.pendingOrder) return next;
  const pendingMatches = matchingOrders(snapshot.pendingOrders, next);
  const historyMatches = matchingOrders(snapshot.recentOrders, next);
  if (pendingMatches.length > 1 || historyMatches.length > 1) {
    throw new Error(
      `exchange returned multiple matches for ${next.pendingOrder.clientOid}`,
    );
  }
  const historyMatch = historyMatches[0];
  const historyStatus = historyMatch?.status.toLowerCase();
  if (historyMatch && historyStatus === "filled") {
    if (!isOpeningTradeSide(historyMatch.tradeSide)) {
      throw new Error(
        `reserved order ${historyMatch.orderId} resolved as ${historyMatch.tradeSide}, not open`,
      );
    }
    return markPendingOrderTerminal(next, next.pendingOrder.clientOid, {
      status: "filled",
      orderId: historyMatch.orderId,
    });
  }
  if (
    historyMatch &&
    (historyStatus === "canceled" ||
      historyStatus === "cancelled" ||
      historyStatus === "rejected")
  ) {
    return markPendingOrderTerminal(next, next.pendingOrder.clientOid, {
      status: "cancelled",
      orderId: historyMatch.orderId,
    });
  }
  const pendingMatch = pendingMatches[0];
  if (pendingMatch) {
    return updatePendingOrder(next, next.pendingOrder.clientOid, {
      status: "submitted",
      orderId: pendingMatch.orderId,
    });
  }
  if (!historyMatch) return next;
  return updatePendingOrder(next, next.pendingOrder.clientOid, {
    status: "timeout",
    orderId: historyMatch.orderId,
  });
}

function exchangeBlockReason(
  snapshot: AutoTraderExchangeSnapshot,
): string | null {
  if (snapshot.openActivityDuringCapture) {
    return `exchange observed opening activity during snapshot capture starting at ${snapshot.captureStartedAt}`;
  }
  if (snapshot.pendingOrders.length > 0) {
    return `exchange has ${snapshot.pendingOrders.length} pending order(s)`;
  }
  if (snapshot.openPositions.length > 0) {
    return `exchange has ${snapshot.openPositions.length} open position(s)`;
  }
  return null;
}

function utcDayStart(now: Date): number {
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}

function runClockBoundaryReason(
  startedAt: Date,
  observedAt: Date,
): string | null {
  if (
    !Number.isFinite(observedAt.getTime()) ||
    observedAt.getTime() < startedAt.getTime() ||
    utcDayStart(observedAt) !== utcDayStart(startedAt)
  ) {
    return "auto-trader blocked: UTC day changed or clock moved backwards during the run";
  }
  return null;
}

function reconciliationSince(state: AutoTraderDailyState, now: Date): number {
  const dayStart = utcDayStart(now);
  const reservedAt = state.pendingOrder
    ? Date.parse(state.pendingOrder.reservedAt)
    : dayStart;
  return Math.min(dayStart, reservedAt);
}

export function buildAutoTraderClientOid(symbol: string, now: Date): string {
  const normalized = symbol
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 12);
  if (normalized.length === 0 || !Number.isFinite(now.getTime())) {
    throw new Error("clientOid requires a symbol and valid timestamp");
  }
  return `ggauto-${now.getTime().toString(36)}-${normalized}`;
}

function resultOrderId(result: BrokerResult): string | null {
  return (
    result.receipt?.orderId ??
    (result.stdout ? extractOrderId(result.stdout) : null)
  );
}

function evidenceRow(input: {
  now: Date;
  mode: AutoTraderMode;
  status: AutoTraderEvidenceStatus;
  candidate: AutoTradeCandidate;
  clientOid: string;
  equityUSDT: number;
  result?: BrokerResult;
  error?: string;
}): AutoTraderEvidenceRow {
  const orderId = input.result ? resultOrderId(input.result) : null;
  return {
    ts: input.now.toISOString(),
    trigger: "auto",
    mode: input.mode,
    status: input.status,
    symbol: input.candidate.row.symbol,
    side: input.candidate.side,
    size: input.candidate.size,
    referencePrice: input.candidate.referencePrice,
    clientOid: input.clientOid,
    orderId,
    receipt: input.result?.receipt,
    balanceBefore: input.equityUSDT,
    balanceAfter: null,
    balanceDelta: null,
    quorumDecision: input.candidate.scenario.quorumDecision,
    risk: {
      equityUSDT: input.equityUSDT,
      riskBudgetUSDT: input.candidate.riskBudgetUSDT,
      notionalUSDT: input.candidate.notionalUSDT,
      positionMultiplier:
        input.candidate.scenario.quorumDecision.positionMultiplier,
    },
    result: input.result,
    ...(input.error ? { error: input.error } : {}),
  };
}

function appendStagedLiveEvidenceOrTrip(input: {
  state: AutoTraderDailyState;
  statePath: string;
  evidence: AutoTraderEvidenceOptions;
  recordEvidence: NonNullable<AutoTraderDeps["recordEvidence"]>;
  useDefaultRecorder: boolean;
}): AutoTraderDailyState {
  const pending = input.state.pendingOrder;
  if (!pending?.evidence) {
    throw new Error("cannot append live evidence before it is staged");
  }
  try {
    const next = input.useDefaultRecorder
      ? replayPendingOrderEvidence(input.state, input.evidence).state
      : (() => {
          const row = prepareLiveAutoTraderEvidence(pending.evidence);
          input.recordEvidence(row, input.evidence);
          return acknowledgePendingOrderEvidence(
            input.state,
            pending.clientOid,
            row.eventId,
          );
        })();
    writeAutoTraderState(input.statePath, next);
    return next;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    writeAutoTraderState(
      input.statePath,
      tripKillSwitch(
        input.state,
        `live evidence append failed for ${pending.clientOid}: ${detail}`,
      ),
    );
    throw error;
  }
}

function stageAndRecordLiveEvidence(input: {
  state: AutoTraderDailyState;
  fallbackState: AutoTraderDailyState;
  row: AutoTraderEvidenceRow;
  statePath: string;
  evidence: AutoTraderEvidenceOptions;
  recordEvidence: NonNullable<AutoTraderDeps["recordEvidence"]>;
  useDefaultRecorder: boolean;
  clientOid: string;
}): AutoTraderDailyState {
  let staged: AutoTraderDailyState;
  try {
    const row = prepareLiveAutoTraderEvidence(input.row);
    staged = stagePendingOrderEvidence(input.state, input.clientOid, row);
    writeAutoTraderState(input.statePath, staged);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    writeAutoTraderState(
      input.statePath,
      tripKillSwitch(
        input.fallbackState,
        `live evidence staging failed for ${input.clientOid}: ${detail}`,
      ),
    );
    throw error;
  }
  return appendStagedLiveEvidenceOrTrip({
    state: staged,
    statePath: input.statePath,
    evidence: input.evidence,
    recordEvidence: input.recordEvidence,
    useDefaultRecorder: input.useDefaultRecorder,
  });
}

function reconcileAndRecordTerminal(input: {
  state: AutoTraderDailyState;
  snapshot: AutoTraderExchangeSnapshot;
  gate: AutoTraderConfig;
  statePath: string;
  evidence: AutoTraderEvidenceOptions;
  recordEvidence: NonNullable<AutoTraderDeps["recordEvidence"]>;
  useDefaultRecorder: boolean;
}): AutoTraderDailyState {
  let next = reconcileAutoTraderState(input.state, input.snapshot, input.gate);
  const terminal = getTerminalPendingOrder(next);
  if (!terminal) {
    writeAutoTraderState(input.statePath, next);
    return next;
  }
  const matches = matchingOrders(input.snapshot.recentOrders, next);
  try {
    if (matches.length !== 1) {
      throw new Error(
        `exchange returned ${matches.length} terminal matches for ${terminal.clientOid}`,
      );
    }
    const row = prepareLiveAutoTraderEvidence(
      buildReconciledOrderEvidence(terminal, matches[0]),
    );
    next = stagePendingOrderEvidence(next, terminal.clientOid, row);
    writeAutoTraderState(input.statePath, next);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    writeAutoTraderState(
      input.statePath,
      tripKillSwitch(
        input.state,
        `live reconciliation evidence failed for ${terminal.clientOid}: ${detail}`,
      ),
    );
    throw error;
  }
  return appendStagedLiveEvidenceOrTrip({
    state: next,
    statePath: input.statePath,
    evidence: input.evidence,
    recordEvidence: input.recordEvidence,
    useDefaultRecorder: input.useDefaultRecorder,
  });
}

function blocked(
  mode: AutoTraderMode,
  status: "disabled" | "blocked" | "no_signal",
  reason: string,
): AutoTraderResult {
  return { mode, status, reason };
}

export async function runAutoTrader(
  args: AutoTraderArgs,
  deps: AutoTraderDeps = {},
): Promise<AutoTraderResult> {
  const env = deps.env ?? process.env;
  const clock = deps.now ?? (() => new Date());
  const now = clock();
  if (!Number.isFinite(now.getTime())) throw new Error("now must be valid");
  if (args.rearmPersistentKill && args.mode !== "live") {
    throw new Error("persistent kill re-arm requires live mode");
  }
  const killSwitchPresent =
    deps.killSwitchPresent ?? autoTraderKillSwitchPresent;
  const earlyKillSwitchPath = envPath(
    env,
    "AUTO_TRADE_KILL_SWITCH_PATH",
    "state/AUTO_TRADE_KILL",
  );
  const earlyKillSwitchPresent = killSwitchPresent(earlyKillSwitchPath);
  if (earlyKillSwitchPresent) {
    return blocked(
      args.mode,
      "blocked",
      `auto-trader blocked: kill-switch file present at ${earlyKillSwitchPath}`,
    );
  }
  const config = runtimeConfig(args.mode, env);
  const earlyGate = args.rearmPersistentKill
    ? { allowed: true as const }
    : evaluateGate(createAutoTraderState(now), config.gate, now, false);
  if (!earlyGate.allowed) {
    return blocked(
      args.mode,
      config.gate.enabled ? "blocked" : "disabled",
      earlyGate.reason ?? "auto-trader gate blocked",
    );
  }

  const lockResult = acquireAutoTraderLock(
    config.gate.lockPath,
    now,
    config.gate.lockMaxAgeMs,
  );
  if (!lockResult.acquired) {
    return blocked(args.mode, "blocked", lockResult.reason);
  }

  try {
    const readExchange =
      deps.readExchange ??
      ((input: { pnlSince: number; orderHistorySince: number }) =>
        readAutoTraderExchangeSnapshot({
          env,
          pnlSince: input.pnlSince,
          orderHistorySince: input.orderHistorySince,
          timeoutMs: config.timeoutMs,
        }));
    const recordEvidence = deps.recordEvidence ?? appendAutoTraderEvidence;
    const useDefaultRecorder = deps.recordEvidence === undefined;
    let state = readAutoTraderState(config.gate.statePath, now);
    if (args.mode === "live" && state.pendingOrder?.evidence) {
      state = appendStagedLiveEvidenceOrTrip({
        state,
        statePath: config.gate.statePath,
        evidence: config.evidence,
        recordEvidence,
        useDefaultRecorder,
      });
    }
    writeAutoTraderState(config.gate.statePath, state);
    const stateKillSwitchPresent = killSwitchPresent(
      config.gate.killSwitchPath,
    );
    const stateGate = evaluateGate(
      state,
      config.gate,
      now,
      stateKillSwitchPresent,
    );
    if (args.rearmPersistentKill) {
      if (stateKillSwitchPresent) {
        return blocked(
          args.mode,
          "blocked",
          stateGate.reason ?? "kill-switch file blocks persistent re-arm",
        );
      }
      const snapshot = await readExchange({
        pnlSince: utcDayStart(now),
        orderHistorySince: reconciliationSince(state, now),
      });
      state = reconcileAndRecordTerminal({
        state,
        snapshot,
        gate: config.gate,
        statePath: config.gate.statePath,
        evidence: config.evidence,
        recordEvidence,
        useDefaultRecorder,
      });
      const exchangeReason = exchangeBlockReason(snapshot);
      if (exchangeReason) return blocked(args.mode, "blocked", exchangeReason);
      if (state.pendingOrder) {
        return blocked(
          args.mode,
          "blocked",
          `auto-trader blocked: pending order ${state.pendingOrder.clientOid} is ${state.pendingOrder.status}; exchange reconciliation required`,
        );
      }
      if (state.realizedPnlUSDT <= -config.gate.maxDailyLossUSDT) {
        return blocked(
          args.mode,
          "blocked",
          `auto-trader blocked: daily realized-trade-PnL cap ${config.gate.maxDailyLossUSDT} USDT remains reached (fills plus USDT fees: ${state.realizedPnlUSDT} USDT)`,
        );
      }
      if (killSwitchPresent(config.gate.killSwitchPath)) {
        return blocked(
          args.mode,
          "blocked",
          `auto-trader blocked: kill-switch file present at ${config.gate.killSwitchPath}`,
        );
      }
      state = clearPersistentKillSwitch(state);
      writeAutoTraderState(config.gate.statePath, state);
      return {
        mode: args.mode,
        status: "rearmed",
        reason:
          "persistent kill switch cleared after locked read-only exchange reconciliation",
      };
    }
    const pendingIsOnlyBlock =
      state.pendingOrder !== null &&
      !stateKillSwitchPresent &&
      !state.killSwitchTripped &&
      state.tradesOpened < config.gate.maxTradesPerDay &&
      state.realizedPnlUSDT > -config.gate.maxDailyLossUSDT;
    if (
      !stateGate.allowed &&
      (args.mode === "dry_run" || !pendingIsOnlyBlock)
    ) {
      return blocked(
        args.mode,
        "blocked",
        stateGate.reason ?? "auto-trader state gate blocked",
      );
    }
    let equityUSDT = config.dryRunEquityUSDT;
    let firstSnapshot: AutoTraderExchangeSnapshot | null = null;

    if (args.mode === "live") {
      firstSnapshot = await readExchange({
        pnlSince: utcDayStart(now),
        orderHistorySince: reconciliationSince(state, now),
      });
      state = reconcileAndRecordTerminal({
        state,
        snapshot: firstSnapshot,
        gate: config.gate,
        statePath: config.gate.statePath,
        evidence: config.evidence,
        recordEvidence,
        useDefaultRecorder,
      });
      const gate = evaluateGate(
        state,
        config.gate,
        now,
        killSwitchPresent(config.gate.killSwitchPath),
      );
      if (!gate.allowed) {
        return blocked(
          args.mode,
          "blocked",
          gate.reason ?? "auto-trader gate blocked after reconciliation",
        );
      }
      const exchangeReason = exchangeBlockReason(firstSnapshot);
      if (exchangeReason) return blocked(args.mode, "blocked", exchangeReason);
      equityUSDT = firstSnapshot.equityUSDT;
    } else {
      const gate = evaluateGate(
        state,
        config.gate,
        now,
        killSwitchPresent(config.gate.killSwitchPath),
      );
      if (!gate.allowed) {
        return blocked(
          args.mode,
          "blocked",
          gate.reason ?? "auto-trader gate blocked",
        );
      }
    }

    const report = await (deps.fetchMarket ?? fetchRwaMarketReport)();
    let selection = selectAutoTradeCandidate({
      report,
      now,
      equityUSDT,
      maxNotionalUSDT: config.maxNotionalUSDT,
      maxPositionPct: config.gate.maxPositionPct,
      maxMarketAgeMs: config.maxMarketAgeMs,
      buildScenario: deps.buildScenario,
    });
    if (!selection.candidate) {
      return blocked(args.mode, "no_signal", selection.reason);
    }

    if (args.mode === "live") {
      const recheckTime = clock();
      const preSnapshotClockReason = runClockBoundaryReason(now, recheckTime);
      if (preSnapshotClockReason) {
        return blocked(args.mode, "blocked", preSnapshotClockReason);
      }
      state = readAutoTraderState(config.gate.statePath, now);
      const preSnapshotGate = evaluateGate(
        state,
        config.gate,
        now,
        killSwitchPresent(config.gate.killSwitchPath),
      );
      if (!preSnapshotGate.allowed) {
        return blocked(
          args.mode,
          "blocked",
          preSnapshotGate.reason ?? "auto-trader gate changed before recheck",
        );
      }
      const preflightEvidence =
        deps.preflightEvidence ?? validateAttestedArenaPreflight;
      preflightEvidence(config.attestedArena, recheckTime);
      const secondSnapshot = await readExchange({
        pnlSince: utcDayStart(now),
        orderHistorySince: reconciliationSince(state, now),
      });
      const postSnapshotClockReason = runClockBoundaryReason(now, clock());
      if (postSnapshotClockReason) {
        return blocked(args.mode, "blocked", postSnapshotClockReason);
      }
      state = reconcileAndRecordTerminal({
        state,
        snapshot: secondSnapshot,
        gate: config.gate,
        statePath: config.gate.statePath,
        evidence: config.evidence,
        recordEvidence,
        useDefaultRecorder,
      });
      const gate = evaluateGate(
        state,
        config.gate,
        now,
        killSwitchPresent(config.gate.killSwitchPath),
      );
      if (!gate.allowed) {
        return blocked(
          args.mode,
          "blocked",
          gate.reason ?? "auto-trader gate changed before placement",
        );
      }
      const exchangeReason = exchangeBlockReason(secondSnapshot);
      if (exchangeReason) return blocked(args.mode, "blocked", exchangeReason);
      equityUSDT = secondSnapshot.equityUSDT;
      selection = selectAutoTradeCandidate({
        report,
        now,
        equityUSDT,
        maxNotionalUSDT: config.maxNotionalUSDT,
        maxPositionPct: config.gate.maxPositionPct,
        maxMarketAgeMs: config.maxMarketAgeMs,
        buildScenario: deps.buildScenario,
      });
      if (!selection.candidate) {
        return blocked(args.mode, "no_signal", selection.reason);
      }
    } else {
      state = readAutoTraderState(config.gate.statePath, now);
      const gate = evaluateGate(
        state,
        config.gate,
        now,
        killSwitchPresent(config.gate.killSwitchPath),
      );
      if (!gate.allowed) {
        return blocked(
          args.mode,
          "blocked",
          gate.reason ?? "auto-trader gate changed before dry-run",
        );
      }
    }

    const candidate = selection.candidate;
    const clientOid = buildAutoTraderClientOid(candidate.row.symbol, now);
    const { stopLossPrice, takeProfitPrice } = computeBracketPrices(
      candidate.side,
      candidate.referencePrice,
      ARENA_DEFAULT_BRACKET_PCT,
      ARENA_DEFAULT_BRACKET_PCT,
    );
    const brokerConfig: BrokerConfig = {
      mode: args.mode,
      passport: candidate.passport,
      maxNotionalUSDT: config.maxNotionalUSDT,
      confirmLive: args.mode === "live",
      marginMode: "isolated",
      leverage: 1,
      env,
      timeoutMs: config.timeoutMs,
      pollAttempts: config.pollAttempts,
      pollIntervalMs: config.pollIntervalMs,
    };
    const intent: FuturesOrderIntent = {
      symbol: candidate.row.symbol,
      side: candidate.side,
      size: candidate.size,
      referencePrice: candidate.referencePrice,
      orderType: "limit",
      limitPrice: candidate.referencePrice,
      force: "fok",
      clientOid,
      stopLossPrice,
      takeProfitPrice,
    };
    const place = deps.place ?? placeFuturesOrder;
    if (args.mode === "dry_run") {
      const result = await place(intent, brokerConfig);
      const row = evidenceRow({
        now,
        mode: args.mode,
        status: "dry_run",
        candidate,
        clientOid,
        equityUSDT,
        result,
      });
      recordEvidence(row, config.evidence);
      return {
        mode: args.mode,
        status: "dry_run",
        reason: "dry-run order plan recorded; no exchange write performed",
        symbol: candidate.row.symbol,
        clientOid,
        brokerResult: result,
      };
    }

    state = readAutoTraderState(config.gate.statePath, now);
    const finalGate = evaluateGate(
      state,
      config.gate,
      now,
      killSwitchPresent(config.gate.killSwitchPath),
    );
    if (!finalGate.allowed) {
      return blocked(
        args.mode,
        "blocked",
        finalGate.reason ?? "auto-trader gate changed before reservation",
      );
    }
    const preReservationTime = clock();
    const preReservationClockReason = runClockBoundaryReason(
      now,
      preReservationTime,
    );
    if (preReservationClockReason) {
      return blocked(args.mode, "blocked", preReservationClockReason);
    }
    state = reservePendingOrder(state, {
      clientOid,
      symbol: candidate.row.symbol,
      reservedAt: preReservationTime.toISOString(),
    });
    writeAutoTraderState(config.gate.statePath, state);
    let entryKillSwitchPresent: boolean;
    try {
      entryKillSwitchPresent = killSwitchPresent(config.gate.killSwitchPath);
    } catch (error) {
      state = clearPendingOrder(state, clientOid);
      writeAutoTraderState(config.gate.statePath, state);
      throw error;
    }
    if (entryKillSwitchPresent) {
      state = clearPendingOrder(state, clientOid);
      writeAutoTraderState(config.gate.statePath, state);
      return blocked(
        args.mode,
        "blocked",
        `auto-trader blocked: kill-switch file present at ${config.gate.killSwitchPath}`,
      );
    }
    const prePlacementClockReason = runClockBoundaryReason(now, clock());
    if (prePlacementClockReason) {
      state = clearPendingOrder(state, clientOid);
      writeAutoTraderState(config.gate.statePath, state);
      return blocked(args.mode, "blocked", prePlacementClockReason);
    }

    let result: BrokerResult;
    try {
      result = await place(intent, brokerConfig);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const brokerResult =
        error instanceof BrokerPostSubmissionError
          ? error.brokerResult
          : undefined;
      const brokerOrderId = brokerResult ? resultOrderId(brokerResult) : null;
      state = updatePendingOrder(state, clientOid, {
        status: brokerResult?.status === "submitted" ? "submitted" : "timeout",
        ...(brokerOrderId ? { orderId: brokerOrderId } : {}),
      });
      if (brokerResult) {
        state = tripKillSwitch(
          state,
          `post-submission broker safety verification failed for ${clientOid}: ${message}`,
        );
      }
      state = stageAndRecordLiveEvidence({
        state,
        fallbackState: state,
        row: evidenceRow({
          now,
          mode: args.mode,
          status: "error",
          candidate,
          clientOid,
          equityUSDT,
          result: brokerResult,
          error: message,
        }),
        statePath: config.gate.statePath,
        evidence: config.evidence,
        recordEvidence,
        useDefaultRecorder,
        clientOid,
      });
      throw error;
    }

    const orderId = resultOrderId(result);
    if (result.status === "dry_run") {
      state = updatePendingOrder(state, clientOid, { status: "timeout" });
      state = stageAndRecordLiveEvidence({
        state,
        fallbackState: state,
        row: evidenceRow({
          now,
          mode: args.mode,
          status: "error",
          candidate,
          clientOid,
          equityUSDT,
          result,
          error: "live broker returned a dry-run result",
        }),
        statePath: config.gate.statePath,
        evidence: config.evidence,
        recordEvidence,
        useDefaultRecorder,
        clientOid,
      });
      throw new Error("live broker returned a dry-run result");
    }
    const filledOrderId = result.status === "filled" ? orderId : null;
    if (result.status === "filled") {
      if (!filledOrderId) {
        state = updatePendingOrder(state, clientOid, { status: "timeout" });
        state = stageAndRecordLiveEvidence({
          state,
          fallbackState: state,
          row: evidenceRow({
            now,
            mode: args.mode,
            status: "error",
            candidate,
            clientOid,
            equityUSDT,
            result,
            error: "filled broker result is missing an orderId",
          }),
          statePath: config.gate.statePath,
          evidence: config.evidence,
          recordEvidence,
          useDefaultRecorder,
          clientOid,
        });
        throw new Error("filled broker result is missing an orderId");
      }
    }

    const row = evidenceRow({
      now,
      mode: args.mode,
      status: result.status,
      candidate,
      clientOid,
      equityUSDT,
      result,
    });
    let fallbackState: AutoTraderDailyState;
    if (filledOrderId) {
      fallbackState = recordTradeOpened(
        updatePendingOrder(state, clientOid, {
          status: "submitted",
          orderId: filledOrderId,
        }),
      );
      state = recordTradeOpened(
        markPendingOrderTerminal(state, clientOid, {
          status: "filled",
          orderId: filledOrderId,
        }),
      );
    } else if (result.status === "cancelled" && orderId) {
      fallbackState = updatePendingOrder(state, clientOid, {
        status: "submitted",
        orderId,
      });
      state = markPendingOrderTerminal(state, clientOid, {
        status: "cancelled",
        orderId,
      });
    } else {
      state = updatePendingOrder(state, clientOid, {
        status: result.status === "submitted" ? "submitted" : "timeout",
        ...(orderId ? { orderId } : {}),
      });
      fallbackState = state;
    }
    state = stageAndRecordLiveEvidence({
      state,
      fallbackState,
      row,
      statePath: config.gate.statePath,
      evidence: config.evidence,
      recordEvidence,
      useDefaultRecorder,
      clientOid,
    });
    return {
      mode: args.mode,
      status: result.status,
      reason: `live order ${result.status}; state and evidence recorded`,
      symbol: candidate.row.symbol,
      clientOid,
      brokerResult: result,
    };
  } finally {
    if (!releaseAutoTraderLock(lockResult.lock)) {
      throw new Error("auto-trader lock ownership changed before release");
    }
  }
}

export async function runAutoTraderCli(): Promise<void> {
  const result = await runAutoTrader(
    parseAutoTraderArgs(process.argv.slice(2)),
  );
  console.log(
    `auto-trader ${result.mode}: ${result.status} - ${result.reason}${result.symbol ? ` (${result.symbol})` : ""}`,
  );
}

if (process.argv[1]?.endsWith("autoTrader.ts")) {
  await runAutoTraderCli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
