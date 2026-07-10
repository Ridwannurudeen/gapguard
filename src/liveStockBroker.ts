import { existsSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { AgentPassport } from "./agentArena";

export type BrokerMode = "dry_run" | "paper" | "live";
export type FuturesSide =
  | "open_long"
  | "open_short"
  | "close_long"
  | "close_short";

export interface FuturesOrderIntent {
  symbol: string;
  side: FuturesSide;
  size: number;
  referencePrice: number;
  clientOid?: string;
  stopLossPrice?: number;
  takeProfitPrice?: number;
}

export interface BrokerConfig {
  mode: BrokerMode;
  passport: AgentPassport;
  maxNotionalUSDT: number;
  confirmLive: boolean;
  marginMode: "isolated";
  leverage: 1 | 2;
  command?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  pollAttempts?: number;
  pollIntervalMs?: number;
}

export interface BgcFuturesOrder {
  symbol: string;
  productType: "USDT-FUTURES";
  marginMode: "isolated";
  marginCoin: "USDT";
  size: string;
  side: "buy" | "sell";
  tradeSide: "open" | "close";
  clientOid: string;
  orderType: "market";
  presetStopLossPrice?: string;
  presetStopSurplusPrice?: string;
}

export interface FuturesOrderPlan {
  mode: BrokerMode;
  order: BgcFuturesOrder;
  notionalUSDT: number;
  command: string;
  args: string[];
}

export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface CommandRunnerOptions {
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
}

export interface BrokerStateTransition {
  ts: string;
  status: "submitted" | "filled" | "cancelled" | "timeout";
  orderId: string | null;
  rawStatus: string | null;
  avgFillPrice: number | null;
  executedQty: number | null;
}

export interface BrokerFillReceipt {
  clientOid: string;
  orderId: string | null;
  status: "dry_run" | "submitted" | "filled" | "cancelled" | "timeout";
  executedQty: number | null;
  avgFillPrice: number | null;
  feeUSDT: number | null;
  realizedPnlUSDT: number | null;
  balanceDelta: number | null;
  transitions: BrokerStateTransition[];
}

export interface LeverageCheck {
  requestedLeverage: number;
  observedLeverage: string | null;
  corrected: boolean;
}

export interface BrokerResult {
  status: "dry_run" | "submitted" | "filled" | "cancelled" | "timeout";
  plan: FuturesOrderPlan;
  receipt?: BrokerFillReceipt;
  stdout?: string;
  stderr?: string;
  leverageCheck?: LeverageCheck;
}

export type CommandRunner = (
  command: string,
  args: string[],
  options?: CommandRunnerOptions,
) => Promise<CommandResult>;

const BLOCKED_BROKER_ENV_KEYS = ["BITGET_API_BASE_URL"];

function formatSize(size: number): string {
  return size.toFixed(8).replace(/0+$/, "").replace(/\.$/, "");
}

function assertFinitePositive(value: number, field: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${field} must be a positive finite number`);
  }
}

function clientOid(symbol: string): string {
  return `gg-${symbol.toLowerCase()}-${randomUUID()}`;
}

export function defaultBgcInvocation(): {
  command: string;
  argsPrefix: string[];
} {
  const localClient = join(
    process.cwd(),
    "node_modules",
    "bitget-client",
    "dist",
    "index.js",
  );
  if (existsSync(localClient)) {
    return { command: process.execPath, argsPrefix: [localClient] };
  }
  throw new Error(
    "local bitget-client executable not found; run npm install before placing broker orders",
  );
}

export function brokerCommandEnv(
  env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const childEnv: NodeJS.ProcessEnv = { ...process.env, ...env };
  for (const key of BLOCKED_BROKER_ENV_KEYS) {
    delete childEnv[key];
  }
  return childEnv;
}

export function bitgetCredentialsPresent(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return Boolean(
    env.BITGET_API_KEY && env.BITGET_SECRET_KEY && env.BITGET_PASSPHRASE,
  );
}

/**
 * Every open order carries a stop-loss and (optionally) a take-profit as
 * Bitget preset TP/SL fields, enforced by the exchange itself — no
 * monitoring process needs to run for the stop to fire. Directions are
 * validated so a wrong-sign bracket (stop-loss on the winning side) is
 * rejected before it ever reaches the exchange rather than silently
 * accepted and doing nothing or triggering instantly.
 */
function validateBracket(
  side: FuturesSide,
  referencePrice: number,
  stopLossPrice: number | undefined,
  takeProfitPrice: number | undefined,
): void {
  const isLong = side === "open_long";
  if (stopLossPrice !== undefined) {
    assertFinitePositive(stopLossPrice, "stopLossPrice");
    if (
      isLong ? stopLossPrice >= referencePrice : stopLossPrice <= referencePrice
    ) {
      throw new Error(
        `stopLossPrice ${stopLossPrice} must be ${isLong ? "below" : "above"} referencePrice ${referencePrice} for ${side}`,
      );
    }
  }
  if (takeProfitPrice !== undefined) {
    assertFinitePositive(takeProfitPrice, "takeProfitPrice");
    if (
      isLong
        ? takeProfitPrice <= referencePrice
        : takeProfitPrice >= referencePrice
    ) {
      throw new Error(
        `takeProfitPrice ${takeProfitPrice} must be ${isLong ? "above" : "below"} referencePrice ${referencePrice} for ${side}`,
      );
    }
  }
}

export function buildFuturesOrder(intent: FuturesOrderIntent): BgcFuturesOrder {
  assertFinitePositive(intent.size, "size");
  assertFinitePositive(intent.referencePrice, "referencePrice");
  if (!intent.symbol) throw new Error("symbol is required");
  const direction = intent.side.endsWith("long") ? "buy" : "sell";
  const tradeSide = intent.side.startsWith("open") ? "open" : "close";

  if (tradeSide === "open") {
    validateBracket(
      intent.side,
      intent.referencePrice,
      intent.stopLossPrice,
      intent.takeProfitPrice,
    );
  }

  return {
    symbol: intent.symbol,
    productType: "USDT-FUTURES",
    marginMode: "isolated",
    marginCoin: "USDT",
    size: formatSize(intent.size),
    side: direction,
    tradeSide,
    clientOid: intent.clientOid ?? clientOid(intent.symbol),
    orderType: "market",
    ...(tradeSide === "open" && intent.stopLossPrice !== undefined
      ? { presetStopLossPrice: intent.stopLossPrice.toString() }
      : {}),
    ...(tradeSide === "open" && intent.takeProfitPrice !== undefined
      ? { presetStopSurplusPrice: intent.takeProfitPrice.toString() }
      : {}),
  };
}

export function buildFuturesOrderPlan(
  intent: FuturesOrderIntent,
  cfg: BrokerConfig,
): FuturesOrderPlan {
  const order = buildFuturesOrder(intent);
  const notionalUSDT = intent.size * intent.referencePrice;

  assertFinitePositive(cfg.maxNotionalUSDT, "maxNotionalUSDT");
  if (cfg.mode === "live") {
    if (cfg.passport.grade !== "LICENSED") {
      throw new Error("live trading requires a LICENSED passport");
    }
    if (!cfg.confirmLive) {
      throw new Error("live trading requires explicit --confirm-live");
    }
    if (cfg.marginMode !== "isolated") {
      throw new Error("live trading requires isolated margin");
    }
    if (cfg.leverage > cfg.passport.license.maxLeverage) {
      throw new Error("requested leverage exceeds passport license");
    }
  }

  const maxAllowed =
    cfg.mode === "live"
      ? Math.min(cfg.maxNotionalUSDT, cfg.passport.license.maxNotionalUSDT)
      : cfg.maxNotionalUSDT;
  if (notionalUSDT > maxAllowed) {
    throw new Error(
      `order notional ${notionalUSDT.toFixed(2)} exceeds cap ${maxAllowed.toFixed(2)}`,
    );
  }

  const invocation = cfg.command
    ? { command: cfg.command, argsPrefix: [] }
    : defaultBgcInvocation();
  const args = [
    ...invocation.argsPrefix,
    ...(cfg.mode === "paper" ? ["--paper-trading"] : []),
    "futures",
    "futures_place_order",
    "--orders",
    JSON.stringify([order]),
  ];

  return {
    mode: cfg.mode,
    order,
    notionalUSDT,
    command: invocation.command,
    args,
  };
}

export async function runCommand(
  command: string,
  args: string[],
  options: CommandRunnerOptions = {},
): Promise<CommandResult> {
  return await new Promise((resolve) => {
    let settled = false;
    const child = spawn(command, args, {
      shell: false,
      env: options.env ? { ...process.env, ...options.env } : process.env,
    });
    let stdout = "";
    let stderr = "";
    const timeout =
      options.timeoutMs && options.timeoutMs > 0
        ? setTimeout(() => {
            if (settled) return;
            settled = true;
            child.kill();
            resolve({
              exitCode: 1,
              stdout,
              stderr: `${stderr}child process timed out after ${options.timeoutMs}ms`,
            });
          }, options.timeoutMs)
        : null;
    const finish = (result: CommandResult) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      resolve(result);
    };
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (err) => {
      finish({ exitCode: 1, stdout, stderr: err.message });
    });
    child.on("close", (code) => {
      finish({ exitCode: code ?? 1, stdout, stderr });
    });
  });
}

/**
 * Best-effort parse of a Bitget Agent Hub response. Bitget signals success with
 * `code: "00000"`; any other code is a rejection even when the CLI exits 0. We
 * scan defensively so surrounding log lines don't break detection — if no code
 * is found we return null and the caller keeps its prior behaviour.
 */
export function interpretBitgetResponse(
  stdout: string,
): { ok: boolean; code: string; msg: string } | null {
  const codeMatch = stdout.match(/"code"\s*:\s*"?([A-Za-z0-9_]+)"?/);
  if (!codeMatch) return null;
  const code = codeMatch[1];
  const msgMatch = stdout.match(/"msg"\s*:\s*"([^"]*)"/);
  return { ok: code === "00000", code, msg: msgMatch ? msgMatch[1] : "" };
}

/** Pull the Bitget orderId out of a place-order response, or null if absent. */
export function extractOrderId(stdout: string): string | null {
  const match = stdout.match(/"orderId"\s*:\s*"?([0-9]+)"?/);
  return match ? match[1] : null;
}

function extractStringField(stdout: string, fields: string[]): string | null {
  for (const field of fields) {
    const match = stdout.match(new RegExp(`"${field}"\\s*:\\s*"([^"]+)"`));
    if (match) return match[1];
  }
  return null;
}

function readNumericField(stdout: string, field: string): number | null {
  const match = stdout.match(
    new RegExp(`"${field}"\\s*:\\s*"?(-?\\d+(?:\\.\\d+)?)"?`),
  );
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

function buildSubmittedReceipt(
  plan: FuturesOrderPlan,
  stdout: string,
): BrokerFillReceipt {
  const orderId = extractOrderId(stdout);
  return {
    clientOid: plan.order.clientOid,
    orderId,
    status: "submitted",
    executedQty: readNumericField(stdout, "executedQty"),
    avgFillPrice: readNumericField(stdout, "avgPrice"),
    feeUSDT: readNumericField(stdout, "fee"),
    realizedPnlUSDT: readNumericField(stdout, "realizedPnl"),
    balanceDelta: null,
    transitions: [
      {
        ts: new Date().toISOString(),
        status: "submitted",
        orderId,
        rawStatus: "submitted",
        avgFillPrice: readNumericField(stdout, "avgPrice"),
        executedQty: readNumericField(stdout, "executedQty"),
      },
    ],
  };
}

function commandPrefix(plan: FuturesOrderPlan): string[] {
  const futuresIndex = plan.args.indexOf("futures");
  return futuresIndex === -1 ? [] : plan.args.slice(0, futuresIndex);
}

function buildOrderDetailArgs(
  plan: FuturesOrderPlan,
  orderId: string,
): string[] {
  return [
    ...commandPrefix(plan),
    "futures",
    "futures_get_orders",
    "--productType",
    "USDT-FUTURES",
    "--symbol",
    plan.order.symbol,
    "--orderId",
    orderId,
  ];
}

function buildOrderFillsArgs(
  plan: FuturesOrderPlan,
  orderId: string,
): string[] {
  return [
    ...commandPrefix(plan),
    "futures",
    "futures_get_fills",
    "--productType",
    "USDT-FUTURES",
    "--symbol",
    plan.order.symbol,
    "--orderId",
    orderId,
  ];
}

/**
 * Bitget applies the account's configured leverage to market orders — the
 * order payload itself carries none. Without this call a live fill silently
 * uses whatever leverage the account last had (observed: 10x against a 1x
 * license), so the leverage must be set explicitly before every submission.
 */
export function buildSetLeverageArgs(
  plan: FuturesOrderPlan,
  cfg: BrokerConfig,
): string[] {
  // buildFuturesOrder maps *_long -> "buy" and *_short -> "sell" for both
  // open and close, so order.side is the position side.
  return [
    ...commandPrefix(plan),
    "futures",
    "futures_set_leverage",
    "--productType",
    "USDT-FUTURES",
    "--symbol",
    plan.order.symbol,
    "--marginCoin",
    plan.order.marginCoin,
    "--leverage",
    String(cfg.leverage),
    "--holdSide",
    plan.order.side === "buy" ? "long" : "short",
  ];
}

function buildGetPositionsArgs(plan: FuturesOrderPlan): string[] {
  return [
    ...commandPrefix(plan),
    "futures",
    "futures_get_positions",
    "--productType",
    "USDT-FUTURES",
    "--symbol",
    plan.order.symbol,
    "--marginCoin",
    plan.order.marginCoin,
  ];
}

/**
 * futures_set_leverage can report success while the leverage it actually
 * applies to the NEXT market order lags behind (observed live: set-leverage
 * confirmed 1x, the order that followed immediately still opened at the
 * account's stale 10x; re-issuing set-leverage against the now-open position
 * fixed it instantly). So after opening a position, read the leverage the
 * exchange actually recorded rather than trust the set-leverage response.
 */
function parsePositionLeverage(
  stdout: string,
  holdSide: string,
): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return null;
  }
  const rows = Array.isArray((parsed as { data?: unknown })?.data)
    ? ((parsed as { data: unknown[] }).data as unknown[])
    : [];
  const match = rows.find(
    (row): row is Record<string, unknown> =>
      typeof row === "object" &&
      row !== null &&
      (row as Record<string, unknown>).holdSide === holdSide,
  );
  const leverage = match?.leverage;
  return typeof leverage === "string" ? leverage : null;
}

function normalizeOrderStatus(
  raw: string | null,
): BrokerStateTransition["status"] {
  const status = raw?.toLowerCase() ?? "";
  if (status.includes("full") || status.includes("filled")) return "filled";
  if (status.includes("cancel")) return "cancelled";
  return "submitted";
}

function mergeFillFields(
  receipt: BrokerFillReceipt,
  stdout: string,
): BrokerFillReceipt {
  const executedQty =
    readNumericField(stdout, "baseVolume") ??
    readNumericField(stdout, "size") ??
    readNumericField(stdout, "fillQuantity") ??
    receipt.executedQty;
  const avgFillPrice =
    readNumericField(stdout, "priceAvg") ??
    readNumericField(stdout, "price") ??
    readNumericField(stdout, "fillPrice") ??
    receipt.avgFillPrice;
  return {
    ...receipt,
    executedQty,
    avgFillPrice,
    feeUSDT: readNumericField(stdout, "fee") ?? receipt.feeUSDT,
    realizedPnlUSDT:
      readNumericField(stdout, "profit") ??
      readNumericField(stdout, "realizedPnl") ??
      receipt.realizedPnlUSDT,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pollFuturesOrderReceipt(
  plan: FuturesOrderPlan,
  submitted: BrokerFillReceipt,
  cfg: BrokerConfig,
  runner: CommandRunner,
): Promise<BrokerFillReceipt> {
  const attempts = cfg.pollAttempts ?? 0;
  if (!submitted.orderId || attempts <= 0) return submitted;

  let receipt = submitted;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (attempt > 0 && cfg.pollIntervalMs && cfg.pollIntervalMs > 0) {
      await sleep(cfg.pollIntervalMs);
    }
    const detail = await runner(
      plan.command,
      buildOrderDetailArgs(plan, submitted.orderId),
      { env: cfg.env, timeoutMs: cfg.timeoutMs },
    );
    if (detail.exitCode !== 0) {
      continue;
    }
    const rawStatus = extractStringField(detail.stdout, [
      "status",
      "state",
      "orderStatus",
    ]);
    const status = normalizeOrderStatus(rawStatus);
    receipt = {
      ...receipt,
      status,
      avgFillPrice:
        readNumericField(detail.stdout, "priceAvg") ?? receipt.avgFillPrice,
      executedQty:
        readNumericField(detail.stdout, "baseVolume") ?? receipt.executedQty,
      transitions: [
        ...receipt.transitions,
        {
          ts: new Date().toISOString(),
          status,
          orderId: submitted.orderId,
          rawStatus,
          avgFillPrice:
            readNumericField(detail.stdout, "priceAvg") ?? receipt.avgFillPrice,
          executedQty:
            readNumericField(detail.stdout, "baseVolume") ??
            receipt.executedQty,
        },
      ],
    };
    if (status === "cancelled") return receipt;
    if (status === "filled") {
      const fills = await runner(
        plan.command,
        buildOrderFillsArgs(plan, submitted.orderId),
        { env: cfg.env, timeoutMs: cfg.timeoutMs },
      );
      return fills.exitCode === 0
        ? mergeFillFields(receipt, fills.stdout)
        : receipt;
    }
  }

  return {
    ...receipt,
    status: "timeout",
    transitions: [
      ...receipt.transitions,
      {
        ts: new Date().toISOString(),
        status: "timeout",
        orderId: submitted.orderId,
        rawStatus: "poll_timeout",
        avgFillPrice: receipt.avgFillPrice,
        executedQty: receipt.executedQty,
      },
    ],
  };
}

function bitgetRejectionHint(msg: string, mode: BrokerMode): string {
  const m = msg.toLowerCase();
  if (m.includes("unsupported") || m.includes("symbol")) {
    return mode === "paper"
      ? " — Bitget Demo Trading lists crypto perps only; RWA stock perps (e.g. NVDAUSDT) are live-only. Use a demo crypto like BTCUSDT for the paper smoke."
      : "";
  }
  if (m.includes("exceeds") && m.includes("balance")) {
    return " — futures USDT balance is too low. Add demo funds in the Bitget Demo dashboard (check with `npm run broker:balance`), then retry.";
  }
  return "";
}

export async function placeFuturesOrder(
  intent: FuturesOrderIntent,
  cfg: BrokerConfig,
  runner: CommandRunner = runCommand,
): Promise<BrokerResult> {
  const plan = buildFuturesOrderPlan(intent, cfg);
  if (cfg.mode === "dry_run") {
    return { status: "dry_run", plan };
  }
  if (!bitgetCredentialsPresent(cfg.env)) {
    throw new Error(
      "BITGET_API_KEY, BITGET_SECRET_KEY, and BITGET_PASSPHRASE are required",
    );
  }
  const childEnv = brokerCommandEnv(cfg.env);

  // Enforce the licensed leverage on the exchange before submitting; a market
  // order otherwise fills at the account's last configured leverage.
  const leverageResult = await runner(
    plan.command,
    buildSetLeverageArgs(plan, cfg),
    { env: childEnv, timeoutMs: cfg.timeoutMs },
  );
  if (leverageResult.exitCode !== 0) {
    throw new Error(
      `set-leverage failed (${leverageResult.exitCode}): ${leverageResult.stderr.slice(0, 240)}`,
    );
  }
  const leverageResponse = interpretBitgetResponse(leverageResult.stdout);
  if (leverageResponse && !leverageResponse.ok) {
    throw new Error(
      `Bitget rejected set-leverage (code ${leverageResponse.code}): ${leverageResponse.msg}`,
    );
  }

  const result = await runner(plan.command, plan.args, {
    env: childEnv,
    timeoutMs: cfg.timeoutMs,
  });
  if (result.exitCode !== 0) {
    throw new Error(
      `bgc exited ${result.exitCode}: ${result.stderr.slice(0, 240)}`,
    );
  }

  // A zero exit code does not mean the order filled — Bitget reports API
  // errors (unsupported symbol, insufficient balance) inside the JSON body.
  const interpreted = interpretBitgetResponse(result.stdout);
  if (interpreted && !interpreted.ok) {
    throw new Error(
      `Bitget rejected the order (code ${interpreted.code}): ${interpreted.msg}${bitgetRejectionHint(interpreted.msg, cfg.mode)}`,
    );
  }

  const receipt = await pollFuturesOrderReceipt(
    plan,
    buildSubmittedReceipt(plan, result.stdout),
    { ...cfg, env: childEnv },
    runner,
  );

  const leverageCheck =
    plan.order.tradeSide === "open"
      ? await verifyAndHealLeverage(plan, cfg, childEnv, runner)
      : undefined;

  return {
    status: receipt.status,
    plan,
    receipt,
    stdout: result.stdout,
    stderr: result.stderr,
    leverageCheck,
  };
}

/**
 * Reads back the leverage the exchange actually recorded on the just-opened
 * position and, if it doesn't match the license, re-issues set-leverage
 * (proven reliable against an existing position) and re-checks once. Throws
 * if the correction itself can't be verified, so a leverage mismatch is
 * never silently left in place.
 */
async function verifyAndHealLeverage(
  plan: FuturesOrderPlan,
  cfg: BrokerConfig,
  childEnv: NodeJS.ProcessEnv,
  runner: CommandRunner,
): Promise<LeverageCheck> {
  const holdSide = plan.order.side === "buy" ? "long" : "short";
  const requestedLeverage = cfg.leverage;

  const readLeverage = async (): Promise<string | null> => {
    const positions = await runner(plan.command, buildGetPositionsArgs(plan), {
      env: childEnv,
      timeoutMs: cfg.timeoutMs,
    });
    return positions.exitCode === 0
      ? parsePositionLeverage(positions.stdout, holdSide)
      : null;
  };

  const observed = await readLeverage();
  if (observed === null || observed === String(requestedLeverage)) {
    return { requestedLeverage, observedLeverage: observed, corrected: false };
  }

  const heal = await runner(plan.command, buildSetLeverageArgs(plan, cfg), {
    env: childEnv,
    timeoutMs: cfg.timeoutMs,
  });
  if (heal.exitCode !== 0) {
    throw new Error(
      `leverage mismatch on ${plan.order.symbol}: exchange reports ${observed}x (expected ${requestedLeverage}x) and the correction call failed (${heal.exitCode}): ${heal.stderr.slice(0, 240)}`,
    );
  }
  const healResponse = interpretBitgetResponse(heal.stdout);
  if (healResponse && !healResponse.ok) {
    throw new Error(
      `leverage mismatch on ${plan.order.symbol}: exchange reports ${observed}x (expected ${requestedLeverage}x) and Bitget rejected the correction (code ${healResponse.code}): ${healResponse.msg}`,
    );
  }

  const healed = await readLeverage();
  if (healed !== String(requestedLeverage)) {
    throw new Error(
      `leverage mismatch on ${plan.order.symbol}: exchange reported ${observed}x, correction call succeeded, but re-check still shows ${healed ?? "unknown"}x (expected ${requestedLeverage}x) — check the position manually`,
    );
  }

  return { requestedLeverage, observedLeverage: healed, corrected: true };
}
