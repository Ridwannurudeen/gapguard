import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { buildArenaPassports, buildDefaultQuorumDecision } from "./arena-demo";
import { ARENA_DEFAULT_BRACKET_PCT } from "./arenaScenario";
import {
  computeBracketPrices,
  extractOrderId,
  placeFuturesOrder,
  type BrokerMode,
  type FuturesSide,
} from "./liveStockBroker";
import { readFuturesAvailable } from "./broker-balance";
import type { QuorumDecision } from "./quorum";

export interface BrokerCliArgs {
  mode: BrokerMode;
  symbol: string;
  side?: FuturesSide;
  size: number;
  referencePrice: number;
  maxNotionalUSDT: number;
  confirmLive: boolean;
  out: string;
  stopLossPct: number | null;
  takeProfitPct: number | null;
}

export function resolveBrokerSide(
  requestedSide: FuturesSide | undefined,
  winningVote: QuorumDecision["winningVote"],
): FuturesSide {
  if (requestedSide !== undefined) return requestedSide;
  if (winningVote === "short") return "open_short";
  if (winningVote === "long") return "open_long";
  throw new Error("flat quorum decision requires explicit --side");
}

function valueAfter(argv: string[], index: number, flag: string): string {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function parseMode(value: string): BrokerMode {
  if (value === "dry_run" || value === "paper" || value === "live")
    return value;
  throw new Error("--mode must be dry_run, paper, or live");
}

function parseSide(value: string): FuturesSide {
  if (
    value === "open_long" ||
    value === "open_short" ||
    value === "close_long" ||
    value === "close_short"
  ) {
    return value;
  }
  throw new Error(
    "--side must be open_long, open_short, close_long, or close_short",
  );
}

function parseNumber(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${flag} must be a positive number`);
  }
  return parsed;
}

/** 0 explicitly disables the bracket leg; unset falls back to the caller's default. */
function parseBracketPct(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${flag} must be a non-negative number`);
  }
  return parsed;
}

function defaultOut(mode: BrokerMode): string {
  if (mode === "live") return "artifacts/live-trades.jsonl";
  if (mode === "paper") return "artifacts/paper-trades.jsonl";
  return "artifacts/order-dry-run.jsonl";
}

function defaultOrderSize(mode: BrokerMode, env: NodeJS.ProcessEnv): number {
  if (mode === "paper") {
    return parseNumber(
      env.ARENA_PAPER_ORDER_SIZE ?? "0.0001",
      "ARENA_PAPER_ORDER_SIZE",
    );
  }
  return parseNumber(
    env.ARENA_LIVE_ORDER_SIZE ?? env.ARENA_ORDER_SIZE ?? "0.03",
    env.ARENA_LIVE_ORDER_SIZE ? "ARENA_LIVE_ORDER_SIZE" : "ARENA_ORDER_SIZE",
  );
}

function defaultReferencePrice(
  mode: BrokerMode,
  env: NodeJS.ProcessEnv,
): number {
  if (mode === "paper") {
    return parseNumber(
      env.ARENA_PAPER_REFERENCE_PRICE ?? "64202",
      "ARENA_PAPER_REFERENCE_PRICE",
    );
  }
  return parseNumber(
    env.ARENA_REFERENCE_PRICE ?? "209.62",
    "ARENA_REFERENCE_PRICE",
  );
}

function optionalNonNegativeInt(
  value: string | undefined,
  field: string,
): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${field} must be a non-negative integer`);
  }
  return parsed;
}

export function parseBrokerCliArgs(
  argv: string[],
  env: NodeJS.ProcessEnv = process.env,
): BrokerCliArgs {
  let mode: BrokerMode = "dry_run";
  let symbol: string | undefined;
  let side: FuturesSide | undefined;
  let size: number | undefined;
  let referencePrice: number | undefined;
  let maxNotionalUSDT = parseNumber(
    env.LIVE_MAX_NOTIONAL_USDT ?? "20",
    "LIVE_MAX_NOTIONAL_USDT",
  );
  let confirmLive = false;
  let out: string | undefined;
  let stopLossPct: number | undefined;
  let takeProfitPct: number | undefined;

  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === "--mode") {
      mode = parseMode(valueAfter(argv, i, flag));
      i += 1;
    } else if (flag === "--symbol") {
      symbol = valueAfter(argv, i, flag);
      i += 1;
    } else if (flag === "--side") {
      side = parseSide(valueAfter(argv, i, flag));
      i += 1;
    } else if (flag === "--size") {
      size = parseNumber(valueAfter(argv, i, flag), flag);
      i += 1;
    } else if (flag === "--reference-price") {
      referencePrice = parseNumber(valueAfter(argv, i, flag), flag);
      i += 1;
    } else if (flag === "--max-notional") {
      maxNotionalUSDT = parseNumber(valueAfter(argv, i, flag), flag);
      i += 1;
    } else if (flag === "--confirm-live") {
      confirmLive = true;
    } else if (flag === "--out") {
      out = valueAfter(argv, i, flag);
      i += 1;
    } else if (flag === "--stop-loss-pct") {
      stopLossPct = parseBracketPct(valueAfter(argv, i, flag), flag);
      i += 1;
    } else if (flag === "--take-profit-pct") {
      takeProfitPct = parseBracketPct(valueAfter(argv, i, flag), flag);
      i += 1;
    } else {
      throw new Error(`unknown argument: ${flag}`);
    }
  }

  // Paper trades run on Bitget Demo, which lists crypto perps only (verified) —
  // so default the paper symbol to a demo-supported crypto, and keep the RWA
  // stock perp as the default for dry-run/live.
  const resolvedSymbol =
    symbol ??
    (mode === "paper"
      ? (env.ARENA_PAPER_SYMBOL ?? "BTCUSDT")
      : (env.ARENA_LIVE_SYMBOL ?? "NVDAUSDT"));
  const resolvedSize = size ?? defaultOrderSize(mode, env);
  const resolvedReferencePrice =
    referencePrice ?? defaultReferencePrice(mode, env);
  // Every live/paper order gets a stop-loss by default, sized off the desk's
  // own constitution (never lose >1.5% overnight) rather than a fresh
  // number, so a position can never be opened unprotected by accident.
  // --stop-loss-pct 0 / --take-profit-pct 0 explicitly opts out.
  const resolvedStopLossPct = stopLossPct ?? ARENA_DEFAULT_BRACKET_PCT;
  const resolvedTakeProfitPct =
    takeProfitPct ?? ARENA_DEFAULT_BRACKET_PCT;

  return {
    mode,
    symbol: resolvedSymbol,
    side,
    stopLossPct: resolvedStopLossPct > 0 ? resolvedStopLossPct : null,
    takeProfitPct: resolvedTakeProfitPct > 0 ? resolvedTakeProfitPct : null,
    size: resolvedSize,
    referencePrice: resolvedReferencePrice,
    maxNotionalUSDT,
    confirmLive,
    out: out ?? defaultOut(mode),
  };
}

export async function runBrokerCli(): Promise<void> {
  const args = parseBrokerCliArgs(process.argv.slice(2));
  const passports = buildArenaPassports();
  const passport = passports[0];
  const decision = buildDefaultQuorumDecision(args.symbol);
  const side = resolveBrokerSide(args.side, decision.winningVote);
  // Submit exactly the requested --size. The Quorum decision sets the default
  // side and is recorded in the artifact for audit, but it must NOT silently
  // scale the size the operator typed: a low-consensus multiplier would shrink
  // or zero the order, which is confusing in paper and dangerous in live.
  const size = args.size;
  // Capture the futures balance before the order so the artifact can prove the
  // account-balance change (read-only; skipped for dry-run, which makes no call).
  const balanceBefore =
    args.mode === "dry_run" ? null : await readFuturesAvailable(args.mode);
  const { stopLossPrice, takeProfitPrice } = computeBracketPrices(
    side,
    args.referencePrice,
    args.stopLossPct,
    args.takeProfitPct,
  );
  const result = await placeFuturesOrder(
    {
      symbol: args.symbol,
      side,
      size,
      referencePrice: args.referencePrice,
      stopLossPrice,
      takeProfitPrice,
    },
    {
      mode: args.mode,
      passport,
      maxNotionalUSDT: args.maxNotionalUSDT,
      confirmLive: args.confirmLive,
      marginMode: "isolated",
      leverage: 1,
      timeoutMs: optionalNonNegativeInt(
        process.env.BITGET_BROKER_TIMEOUT_MS,
        "BITGET_BROKER_TIMEOUT_MS",
      ),
      pollAttempts: optionalNonNegativeInt(
        process.env.BITGET_BROKER_POLL_ATTEMPTS,
        "BITGET_BROKER_POLL_ATTEMPTS",
      ),
      pollIntervalMs: optionalNonNegativeInt(
        process.env.BITGET_BROKER_POLL_INTERVAL_MS,
        "BITGET_BROKER_POLL_INTERVAL_MS",
      ),
    },
  );
  const orderId =
    result.receipt?.orderId ??
    (result.stdout ? extractOrderId(result.stdout) : null);
  const balanceAfter =
    args.mode === "dry_run" ? null : await readFuturesAvailable(args.mode);
  const balanceDelta =
    balanceBefore !== null && balanceAfter !== null
      ? balanceAfter - balanceBefore
      : null;
  const out = resolve(args.out);
  mkdirSync(dirname(out), { recursive: true });
  appendFileSync(
    out,
    `${JSON.stringify({
      ts: new Date().toISOString(),
      symbol: args.symbol,
      side,
      size: args.size,
      referencePrice: args.referencePrice,
      mode: args.mode,
      clientOid: result.plan.order.clientOid,
      orderId,
      receipt: result.receipt,
      balanceBefore,
      balanceAfter,
      balanceDelta,
      quorumDecision: decision,
      result,
    })}\n`,
  );
  const leverageNote = result.leverageCheck
    ? `; leverage ${result.leverageCheck.observedLeverage ?? "unknown"}x${result.leverageCheck.corrected ? " (corrected)" : ""}`
    : "";
  const bracketNote =
    stopLossPrice !== undefined || takeProfitPrice !== undefined
      ? `; bracket SL=${stopLossPrice?.toFixed(2) ?? "none"} TP=${takeProfitPrice?.toFixed(2) ?? "none"}`
      : "";
  console.log(
    `${result.status} ${args.symbol} ${side} size ${args.size} (${args.mode}) order ${orderId ?? "n/a"}; balance ${balanceBefore ?? "n/a"} -> ${balanceAfter ?? "n/a"} (Δ ${balanceDelta ?? "n/a"})${leverageNote}${bracketNote}; quorum x${decision.positionMultiplier} recorded, not applied -> ${out}`,
  );
}

if (process.argv[1]?.endsWith("broker-cli.ts")) {
  await runBrokerCli();
}
