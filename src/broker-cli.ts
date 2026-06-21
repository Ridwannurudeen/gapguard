import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { buildArenaPassports, buildDefaultQuorumDecision } from "./arena-demo";
import {
  extractOrderId,
  placeFuturesOrder,
  type BrokerMode,
  type FuturesSide,
} from "./liveStockBroker";
import { readFuturesAvailable } from "./broker-balance";

export interface BrokerCliArgs {
  mode: BrokerMode;
  symbol: string;
  side?: FuturesSide;
  size: number;
  referencePrice: number;
  maxNotionalUSDT: number;
  confirmLive: boolean;
  out: string;
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

function defaultOut(mode: BrokerMode): string {
  if (mode === "live") return "artifacts/live-trades.jsonl";
  if (mode === "paper") return "artifacts/paper-trades.jsonl";
  return "artifacts/order-dry-run.jsonl";
}

export function parseBrokerCliArgs(
  argv: string[],
  env: NodeJS.ProcessEnv = process.env,
): BrokerCliArgs {
  let mode: BrokerMode = "dry_run";
  let symbol: string | undefined;
  let side: FuturesSide | undefined;
  let size = parseNumber(env.ARENA_ORDER_SIZE ?? "0.01", "ARENA_ORDER_SIZE");
  let referencePrice = parseNumber(
    env.ARENA_REFERENCE_PRICE ?? "209.62",
    "ARENA_REFERENCE_PRICE",
  );
  let maxNotionalUSDT = parseNumber(
    env.LIVE_MAX_NOTIONAL_USDT ?? "20",
    "LIVE_MAX_NOTIONAL_USDT",
  );
  let confirmLive = false;
  let out: string | undefined;

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

  return {
    mode,
    symbol: resolvedSymbol,
    side,
    size,
    referencePrice,
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
  const side =
    args.side ??
    (decision.winningVote === "short" ? "open_short" : "open_long");
  // Submit exactly the requested --size. The Quorum decision sets the default
  // side and is recorded in the artifact for audit, but it must NOT silently
  // scale the size the operator typed: a low-consensus multiplier would shrink
  // or zero the order, which is confusing in paper and dangerous in live.
  const size = args.size;
  // Capture the futures balance before the order so the artifact can prove the
  // account-balance change (read-only; skipped for dry-run, which makes no call).
  const balanceBefore =
    args.mode === "dry_run" ? null : await readFuturesAvailable(args.mode);
  const result = await placeFuturesOrder(
    {
      symbol: args.symbol,
      side,
      size,
      referencePrice: args.referencePrice,
    },
    {
      mode: args.mode,
      passport,
      maxNotionalUSDT: args.maxNotionalUSDT,
      confirmLive: args.confirmLive,
      marginMode: "isolated",
      leverage: 1,
    },
  );
  const orderId = result.stdout ? extractOrderId(result.stdout) : null;
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
      orderId,
      balanceBefore,
      balanceAfter,
      balanceDelta,
      quorumDecision: decision,
      result,
    })}\n`,
  );
  console.log(
    `${result.status} ${args.symbol} ${side} size ${args.size} (${args.mode}) order ${orderId ?? "n/a"}; balance ${balanceBefore ?? "n/a"} -> ${balanceAfter ?? "n/a"} (Δ ${balanceDelta ?? "n/a"}); quorum x${decision.positionMultiplier} recorded, not applied -> ${out}`,
  );
}

if (process.argv[1]?.endsWith("broker-cli.ts")) {
  await runBrokerCli();
}
