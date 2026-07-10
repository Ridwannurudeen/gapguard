import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { buildArenaPassports } from "./arena-demo";
import {
  appendAttestedArenaRecord,
  validateAttestedArenaPreflight,
  type AttestedArenaConfig,
  type ArenaRecordInput,
} from "./arena-chain";
import { DEFAULT_PUBLIC_KEY_FILE } from "./arenaSigning";
import { readFuturesAvailable } from "./broker-balance";
import {
  placeFuturesOrder,
  type BrokerConfig,
  type BrokerMode,
  type BrokerResult,
  type FuturesOrderIntent,
  type FuturesSide,
} from "./liveStockBroker";
import type { RwaMarketReport, RwaMarketRow } from "./rwa-market";

export interface RwaRoundTripArgs {
  mode: Extract<BrokerMode, "dry_run" | "live">;
  symbol?: string;
  side: "long" | "short";
  size?: number;
  referencePrice?: number;
  maxNotionalUSDT: number;
  confirmLive: boolean;
  appendChain: boolean;
  clientOidPrefix?: string;
  marketPath: string;
  out: string;
  chainOut: string;
  attestOut: string;
  publicKeyPath: string;
}

export interface RwaRoundTripSpec {
  symbol: string;
  side: "long" | "short";
  size: number;
  referencePrice: number;
  maxNotionalUSDT: number;
  notionalUSDT: number;
  row: RwaMarketRow | null;
  openSide: FuturesSide;
  closeSide: FuturesSide;
  openClientOid: string;
  closeClientOid: string;
}

export interface RwaRoundTripResult {
  ts: string;
  roundTripId: string;
  mode: RwaRoundTripArgs["mode"];
  spec: RwaRoundTripSpec;
  balanceBefore: number | null;
  balanceAfter: number | null;
  open: BrokerResult;
  close: BrokerResult;
  chainAppended: boolean;
}

export type RoundTripPlaceOrder = (
  intent: FuturesOrderIntent,
  cfg: BrokerConfig,
) => Promise<BrokerResult>;

export interface RwaRoundTripDeps {
  market?: RwaMarketReport;
  now?: () => Date;
  place?: RoundTripPlaceOrder;
  readBalance?: (mode: "live") => Promise<number | null>;
  env?: NodeJS.ProcessEnv;
}

function valueAfter(argv: string[], index: number, flag: string): string {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function parsePositive(value: string, field: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${field} must be a positive number`);
  }
  return parsed;
}

export function parseRwaRoundTripArgs(
  argv: string[],
  env: NodeJS.ProcessEnv = process.env,
): RwaRoundTripArgs {
  let mode: RwaRoundTripArgs["mode"] = "dry_run";
  let symbol: string | undefined;
  let side: "long" | "short" = "long";
  let size: number | undefined;
  let referencePrice: number | undefined;
  let maxNotionalUSDT = parsePositive(
    env.RWA_ROUND_TRIP_MAX_NOTIONAL_USDT ?? "10",
    "RWA_ROUND_TRIP_MAX_NOTIONAL_USDT",
  );
  let confirmLive = false;
  let appendChain = false;
  let clientOidPrefix: string | undefined;
  let marketPath = env.ARENA_RWA_MARKET_PATH ?? "public/rwa-market.json";
  let out = "artifacts/rwa-roundtrip.jsonl";
  let chainOut = "public/arena-chain.jsonl";
  let attestOut = "public/arena-attestation.json";
  let publicKeyPath = DEFAULT_PUBLIC_KEY_FILE;

  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === "--mode") {
      const value = valueAfter(argv, i, flag);
      if (value !== "dry_run" && value !== "live") {
        throw new Error("--mode must be dry_run or live");
      }
      mode = value;
      i += 1;
    } else if (flag === "--symbol") {
      symbol = valueAfter(argv, i, flag);
      i += 1;
    } else if (flag === "--side") {
      const value = valueAfter(argv, i, flag);
      if (value !== "long" && value !== "short") {
        throw new Error("--side must be long or short");
      }
      side = value;
      i += 1;
    } else if (flag === "--size") {
      size = parsePositive(valueAfter(argv, i, flag), flag);
      i += 1;
    } else if (flag === "--reference-price") {
      referencePrice = parsePositive(valueAfter(argv, i, flag), flag);
      i += 1;
    } else if (flag === "--max-notional") {
      maxNotionalUSDT = parsePositive(valueAfter(argv, i, flag), flag);
      i += 1;
    } else if (flag === "--client-oid-prefix") {
      clientOidPrefix = valueAfter(argv, i, flag);
      i += 1;
    } else if (flag === "--market") {
      marketPath = valueAfter(argv, i, flag);
      i += 1;
    } else if (flag === "--out") {
      out = valueAfter(argv, i, flag);
      i += 1;
    } else if (flag === "--chain") {
      chainOut = valueAfter(argv, i, flag);
      i += 1;
    } else if (flag === "--attestation") {
      attestOut = valueAfter(argv, i, flag);
      i += 1;
    } else if (flag === "--public-key") {
      publicKeyPath = valueAfter(argv, i, flag);
      i += 1;
    } else if (flag === "--confirm-live") {
      confirmLive = true;
    } else if (flag === "--append-chain") {
      appendChain = true;
    } else {
      throw new Error(`unknown argument: ${flag}`);
    }
  }

  return {
    mode,
    symbol,
    side,
    size,
    referencePrice,
    maxNotionalUSDT,
    confirmLive,
    appendChain,
    clientOidPrefix,
    marketPath,
    out,
    chainOut,
    attestOut,
    publicKeyPath,
  };
}

function readMarket(path: string): RwaMarketReport | null {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as RwaMarketReport;
}

function selectedRow(
  market: RwaMarketReport | null,
  symbol: string | undefined,
): RwaMarketRow | null {
  if (!market) return null;
  const selected = symbol ?? market.selectedLiveSymbol ?? market.defaultLiveSymbol;
  return market.rows.find((row) => row.symbol === selected) ?? null;
}

function defaultRoundTripId(symbol: string, mode: RwaRoundTripArgs["mode"]): string {
  return `gg-rwa-${mode}-${symbol.toLowerCase()}-${Date.now()}`;
}

function ensureUnusedClientOid(path: string, clientOidPrefix: string): void {
  if (!existsSync(path)) return;
  const text = readFileSync(path, "utf8");
  if (
    text.includes(`${clientOidPrefix}-open`) ||
    text.includes(`${clientOidPrefix}-close`)
  ) {
    throw new Error(`clientOid prefix already recorded in ${path}`);
  }
}

export function buildRwaRoundTripSpec(
  args: RwaRoundTripArgs,
  market: RwaMarketReport | null,
): RwaRoundTripSpec {
  const row = selectedRow(market, args.symbol);
  const symbol =
    args.symbol ?? row?.symbol ?? market?.selectedLiveSymbol ?? "NVDAUSDT";
  const referencePrice =
    args.referencePrice ?? row?.lastPrice ?? row?.indexPrice ?? null;
  if (referencePrice === null || referencePrice <= 0) {
    throw new Error("reference price is required for RWA round-trip sizing");
  }
  if (args.mode === "live") {
    if (!args.clientOidPrefix) {
      throw new Error("live RWA round-trip requires --client-oid-prefix");
    }
    if (!row) {
      throw new Error("live RWA round-trip requires a current RWA market row");
    }
    if (!row.liveReady) {
      throw new Error(
        `live RWA round-trip blocked: ${row.blockers.join(", ") || "market row is not live-ready"}`,
      );
    }
  }
  const size = args.size ?? row?.suggestedMinSize ?? 0.03;
  const notionalUSDT = size * referencePrice;
  if (notionalUSDT > args.maxNotionalUSDT) {
    throw new Error(
      `round-trip notional ${notionalUSDT.toFixed(2)} exceeds cap ${args.maxNotionalUSDT.toFixed(2)}`,
    );
  }
  const clientOidPrefix =
    args.clientOidPrefix ?? defaultRoundTripId(symbol, args.mode);
  return {
    symbol,
    side: args.side,
    size,
    referencePrice,
    maxNotionalUSDT: args.maxNotionalUSDT,
    notionalUSDT,
    row,
    openSide: args.side === "long" ? "open_long" : "open_short",
    closeSide: args.side === "long" ? "close_long" : "close_short",
    openClientOid: `${clientOidPrefix}-open`,
    closeClientOid: `${clientOidPrefix}-close`,
  };
}

function roundTripAttestedArenaConfig(
  args: RwaRoundTripArgs,
  env: NodeJS.ProcessEnv,
): AttestedArenaConfig {
  return {
    chainPath: resolve(args.chainOut),
    attestationPath: resolve(args.attestOut),
    publicKeyPath: resolve(args.publicKeyPath),
    lockPath: resolve(
      env.AUTO_TRADE_ARENA_LOCK_PATH ?? "state/arena-chain.lock",
    ),
    env,
    model: "GapGuard live RWA round-trip receipt",
  };
}

function appendRoundTripToChain(
  result: RwaRoundTripResult,
  args: RwaRoundTripArgs,
  env: NodeJS.ProcessEnv,
): void {
  if (result.mode !== "live") {
    throw new Error("--append-chain is only allowed for live round-trip evidence");
  }
  if (result.open.status !== "filled" || result.close.status !== "filled") {
    throw new Error("chain append requires both open and close orders filled");
  }
  const nextInput: ArenaRecordInput = {
    ts: result.ts,
    kind: "broker_order",
    agentId: "quorum",
    payload: {
      label: "LIVE_RWA_ROUND_TRIP",
      roundTripId: result.roundTripId,
      symbol: result.spec.symbol,
      side: result.spec.side,
      size: result.spec.size,
      referencePrice: result.spec.referencePrice,
      notionalUSDT: result.spec.notionalUSDT,
      open: result.open.receipt,
      close: result.close.receipt,
      balanceBefore: result.balanceBefore,
      balanceAfter: result.balanceAfter,
    },
  };
  appendAttestedArenaRecord(
    nextInput,
    roundTripAttestedArenaConfig(args, env),
  );
}

export async function runRwaRoundTrip(
  args: RwaRoundTripArgs,
  deps: RwaRoundTripDeps = {},
): Promise<RwaRoundTripResult> {
  const env = deps.env ?? process.env;
  const market = deps.market ?? readMarket(resolve(args.marketPath));
  const spec = buildRwaRoundTripSpec(args, market);
  ensureUnusedClientOid(resolve(args.out), spec.openClientOid.replace(/-open$/, ""));
  if (args.appendChain) {
    if (args.mode !== "live") {
      throw new Error("--append-chain is only allowed for live round-trip evidence");
    }
    validateAttestedArenaPreflight(roundTripAttestedArenaConfig(args, env));
  }

  const passport = buildArenaPassports()[0];
  const cfg: BrokerConfig = {
    mode: args.mode,
    passport,
    maxNotionalUSDT: args.maxNotionalUSDT,
    confirmLive: args.confirmLive,
    marginMode: "isolated",
    leverage: 1,
    env,
    timeoutMs: Number(env.BITGET_BROKER_TIMEOUT_MS ?? 30_000),
    pollAttempts: Number(env.BITGET_BROKER_POLL_ATTEMPTS ?? 10),
    pollIntervalMs: Number(env.BITGET_BROKER_POLL_INTERVAL_MS ?? 1_000),
  };
  const place = deps.place ?? placeFuturesOrder;
  const readBalance = deps.readBalance ?? readFuturesAvailable;
  const balanceBefore =
    args.mode === "live" ? await readBalance("live") : null;
  if (args.mode === "live" && balanceBefore === null) {
    throw new Error("live RWA round-trip preflight requires readable balance");
  }
  if (args.mode === "live" && balanceBefore !== null && balanceBefore < spec.notionalUSDT) {
    throw new Error("live RWA round-trip blocked: available balance below notional");
  }

  const open = await place(
    {
      symbol: spec.symbol,
      side: spec.openSide,
      size: spec.size,
      referencePrice: spec.referencePrice,
      clientOid: spec.openClientOid,
    },
    cfg,
  );
  if (args.mode === "live" && open.status !== "filled") {
    throw new Error(`open order status ${open.status}; refusing close leg`);
  }
  const close = await place(
    {
      symbol: spec.symbol,
      side: spec.closeSide,
      size: spec.size,
      referencePrice: spec.referencePrice,
      clientOid: spec.closeClientOid,
    },
    cfg,
  );
  const balanceAfter =
    args.mode === "live" ? await readBalance("live") : null;
  const ts = (deps.now ?? (() => new Date()))().toISOString();
  const result: RwaRoundTripResult = {
    ts,
    roundTripId: spec.openClientOid.replace(/-open$/, ""),
    mode: args.mode,
    spec,
    balanceBefore,
    balanceAfter,
    open,
    close,
    chainAppended: false,
  };
  if (args.appendChain) {
    appendRoundTripToChain(result, args, env);
    result.chainAppended = true;
  }
  mkdirSync(dirname(resolve(args.out)), { recursive: true });
  appendFileSync(resolve(args.out), `${JSON.stringify(result)}\n`);
  return result;
}

export async function runRwaRoundTripCli(): Promise<void> {
  const args = parseRwaRoundTripArgs(process.argv.slice(2));
  const result = await runRwaRoundTrip(args);
  console.log(
    `rwa round-trip ${result.mode}: ${result.spec.symbol} ${result.spec.side} ${result.spec.size} (${result.spec.notionalUSDT.toFixed(2)} USDT) open=${result.open.status} close=${result.close.status} chain=${result.chainAppended}`,
  );
}

if (process.argv[1]?.endsWith("rwaRoundTrip.ts")) {
  await runRwaRoundTripCli().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
