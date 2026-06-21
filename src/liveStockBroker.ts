import { existsSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
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
}

export interface BgcFuturesOrder {
  symbol: string;
  productType: "USDT-FUTURES";
  marginMode: "isolated";
  marginCoin: "USDT";
  size: string;
  side: "buy" | "sell";
  tradeSide: "open" | "close";
  orderType: "market";
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

export interface BrokerResult {
  status: "dry_run" | "submitted";
  plan: FuturesOrderPlan;
  stdout?: string;
  stderr?: string;
}

export type CommandRunner = (
  command: string,
  args: string[],
) => Promise<CommandResult>;

function formatSize(size: number): string {
  return size.toFixed(8).replace(/0+$/, "").replace(/\.$/, "");
}

function assertFinitePositive(value: number, field: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${field} must be a positive finite number`);
  }
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
  return { command: "bgc", argsPrefix: [] };
}

export function bitgetCredentialsPresent(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return Boolean(
    env.BITGET_API_KEY && env.BITGET_SECRET_KEY && env.BITGET_PASSPHRASE,
  );
}

export function buildFuturesOrder(intent: FuturesOrderIntent): BgcFuturesOrder {
  assertFinitePositive(intent.size, "size");
  assertFinitePositive(intent.referencePrice, "referencePrice");
  if (!intent.symbol) throw new Error("symbol is required");
  const direction = intent.side.endsWith("long") ? "buy" : "sell";
  const tradeSide = intent.side.startsWith("open") ? "open" : "close";

  return {
    symbol: intent.symbol,
    productType: "USDT-FUTURES",
    marginMode: "isolated",
    marginCoin: "USDT",
    size: formatSize(intent.size),
    side: direction,
    tradeSide,
    orderType: "market",
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
): Promise<CommandResult> {
  return await new Promise((resolve) => {
    const child = spawn(command, args, { shell: false });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (err) => {
      resolve({ exitCode: 1, stdout, stderr: err.message });
    });
    child.on("close", (code) => {
      resolve({ exitCode: code ?? 1, stdout, stderr });
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

  const result = await runner(plan.command, plan.args);
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

  return {
    status: "submitted",
    plan,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}
