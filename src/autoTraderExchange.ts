import {
  bitgetCredentialsPresent,
  brokerCommandEnv,
  defaultBgcInvocation,
  runCommand,
  type CommandResult,
  type CommandRunner,
} from "./liveStockBroker";

const PRODUCT_TYPE = "USDT-FUTURES";
const MARGIN_COIN = "USDT";
const PAGE_LIMIT = 100;
const MAX_FILL_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

const ENDPOINTS = {
  account: "GET /api/v2/mix/account/accounts",
  pending: "GET /api/v2/mix/order/orders-pending",
  positions: "GET /api/v2/mix/position/all-position",
  fills: "GET /api/v2/mix/order/fill-history",
  history: "GET /api/v2/mix/order/orders-history",
} as const;

type QueryKind = keyof typeof ENDPOINTS;
type UnknownRecord = Record<string, unknown>;

interface ParsedFill {
  tradeId: string;
  tradeSide: string;
  createdAt: number;
  realizedPnlUSDT: number;
}

export interface AutoTraderExchangeOrder {
  orderId: string;
  clientOid: string | null;
  symbol: string;
  status: string;
  tradeSide: string;
  createdAt: number;
}

export interface AutoTraderExchangePosition {
  marginCoin: "USDT";
  symbol: string;
  holdSide: string;
  total: number;
  openDelegateSize: number;
}

export interface AutoTraderExchangeSnapshot {
  equityUSDT: number;
  realizedPnlUSDT: number;
  pendingOrders: AutoTraderExchangeOrder[];
  openPositions: AutoTraderExchangePosition[];
  recentOrders: AutoTraderExchangeOrder[];
  captureStartedAt: string;
  openActivityDuringCapture: boolean;
  capturedAt: string;
}

export interface AutoTraderExchangeDeps {
  runner?: CommandRunner;
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
  pnlSince?: number;
  orderHistorySince?: number;
  timeoutMs?: number;
}

function requireRecord(value: unknown, path: string): UnknownRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${path} must be an object`);
  }
  return value as UnknownRecord;
}

function requireArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`${path} must be an array`);
  }
  return value;
}

function requireString(
  record: UnknownRecord,
  field: string,
  path: string,
): string {
  const value = record[field];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${path}.${field} must be a non-empty string`);
  }
  return value;
}

function optionalString(
  record: UnknownRecord,
  field: string,
  path: string,
): string | null {
  const value = record[field];
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") {
    throw new Error(`${path}.${field} must be a string when present`);
  }
  return value;
}

function requireApiNumber(
  record: UnknownRecord,
  field: string,
  path: string,
): number {
  const value = record[field];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${path}.${field} must be a numeric string`);
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${path}.${field} must be a finite numeric string`);
  }
  return parsed;
}

function parseNormalizedResponse(stdout: string, kind: QueryKind): unknown {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new Error(`${kind} response is not valid JSON`);
  }
  const wrapper = requireRecord(parsed, `${kind} response`);
  const keys = Object.keys(wrapper).sort();
  if (keys.join(",") !== "data,endpoint,requestTime") {
    throw new Error(
      `${kind} response must be the normalized {endpoint, requestTime, data} wrapper`,
    );
  }
  if (wrapper.endpoint !== ENDPOINTS[kind]) {
    throw new Error(`${kind} response endpoint must be ${ENDPOINTS[kind]}`);
  }
  if (
    typeof wrapper.requestTime !== "string" ||
    !Number.isFinite(Date.parse(wrapper.requestTime))
  ) {
    throw new Error(`${kind} response requestTime must be a timestamp string`);
  }
  return wrapper.data;
}

function parseEquity(data: unknown): number {
  const rows = requireArray(data, "account.data");
  const matches = rows
    .map((row, index) => requireRecord(row, `account.data[${index}]`))
    .filter((row) => row.marginCoin === MARGIN_COIN);
  if (matches.length !== 1) {
    throw new Error("account.data must contain exactly one USDT account");
  }
  const equity = requireApiNumber(
    matches[0],
    "accountEquity",
    "account.data[USDT]",
  );
  if (equity <= 0) {
    throw new Error("account.data[USDT].accountEquity must be positive");
  }
  return equity;
}

function continuationMarker(data: UnknownRecord): string | null {
  for (const marker of ["hasMore", "hasNext", "nextPage", "nextCursor"]) {
    const value = data[marker];
    if (
      value === true ||
      value === "true" ||
      (typeof value === "number" && value > 0) ||
      (typeof value === "string" && value !== "" && value !== "0")
    ) {
      return marker;
    }
  }
  return null;
}

function assertCompletePage(
  data: UnknownRecord,
  rows: unknown[],
  path: string,
): void {
  if (typeof data.endId !== "string") {
    throw new Error(`${path}.endId must be a string`);
  }
  if (rows.length >= PAGE_LIMIT) {
    throw new Error(
      `${path} may be incomplete: received the installed CLI's unpageable limit of ${PAGE_LIMIT}`,
    );
  }
  const marker = continuationMarker(data);
  if (marker) {
    throw new Error(`${path} has continuation marker ${marker}`);
  }
}

function parseOrder(row: unknown, path: string): AutoTraderExchangeOrder {
  const record = requireRecord(row, path);
  const createdAt = requireApiNumber(record, "cTime", path);
  if (!Number.isSafeInteger(createdAt) || createdAt < 0) {
    throw new Error(
      `${path}.cTime must be a non-negative millisecond timestamp`,
    );
  }
  return {
    orderId: requireString(record, "orderId", path),
    clientOid: optionalString(record, "clientOid", path),
    symbol: requireString(record, "symbol", path),
    status: requireString(record, "status", path),
    tradeSide: requireString(record, "tradeSide", path),
    createdAt,
  };
}

function parseOrders(data: unknown, path: "pending.data" | "history.data") {
  const record = requireRecord(data, path);
  const rows = requireArray(record.entrustedList, `${path}.entrustedList`);
  assertCompletePage(record, rows, path);
  return rows.map((row, index) =>
    parseOrder(row, `${path}.entrustedList[${index}]`),
  );
}

function parsePositions(data: unknown): AutoTraderExchangePosition[] {
  const rows = requireArray(data, "positions.data");
  return rows
    .map((row, index): AutoTraderExchangePosition => {
      const path = `positions.data[${index}]`;
      const record = requireRecord(row, path);
      const marginCoin = requireString(record, "marginCoin", path);
      if (marginCoin !== MARGIN_COIN) {
        throw new Error(`${path}.marginCoin must be USDT`);
      }
      return {
        marginCoin,
        symbol: requireString(record, "symbol", path),
        holdSide: requireString(record, "holdSide", path),
        total: requireApiNumber(record, "total", path),
        openDelegateSize: requireApiNumber(record, "openDelegateSize", path),
      };
    })
    .filter(
      (position) => position.total !== 0 || position.openDelegateSize !== 0,
    );
}

export function isOpeningTradeSide(tradeSide: string): boolean {
  const normalized = tradeSide.toLowerCase();
  return (
    normalized === "open" ||
    normalized === "buy_single" ||
    normalized === "sell_single"
  );
}

function parseFills(data: unknown): ParsedFill[] {
  const record = requireRecord(data, "fills.data");
  const rows = requireArray(record.fillList, "fills.data.fillList");
  assertCompletePage(record, rows, "fills.data");

  const parsed: ParsedFill[] = [];
  for (let index = 0; index < rows.length; index += 1) {
    const path = `fills.data.fillList[${index}]`;
    const fill = requireRecord(rows[index], path);
    const tradeId = requireString(fill, "tradeId", path);
    if (requireString(fill, "marginCoin", path) !== MARGIN_COIN) {
      throw new Error(`${path}.marginCoin must be USDT`);
    }
    const tradeSide = requireString(fill, "tradeSide", path);
    const createdAt = requireApiNumber(fill, "cTime", path);
    if (!Number.isSafeInteger(createdAt) || createdAt < 0) {
      throw new Error(
        `${path}.cTime must be a non-negative millisecond timestamp`,
      );
    }
    let realizedPnlUSDT = requireApiNumber(fill, "profit", path);

    const fees = requireArray(fill.feeDetail, `${path}.feeDetail`);
    for (let feeIndex = 0; feeIndex < fees.length; feeIndex += 1) {
      const feePath = `${path}.feeDetail[${feeIndex}]`;
      const fee = requireRecord(fees[feeIndex], feePath);
      const feeCoin = requireString(fee, "feeCoin", feePath);
      const totalFee = requireApiNumber(fee, "totalFee", feePath);
      if (feeCoin !== MARGIN_COIN && totalFee !== 0) {
        throw new Error(`${feePath} contains a non-USDT fee`);
      }
      if (feeCoin === MARGIN_COIN) realizedPnlUSDT += totalFee;
    }

    if (!Number.isFinite(realizedPnlUSDT)) {
      throw new Error(`${path} produced non-finite realized USDT PnL`);
    }
    parsed.push({ tradeId, tradeSide, createdAt, realizedPnlUSDT });
  }
  return parsed;
}

function mergeFills(first: ParsedFill[], tail: ParsedFill[]): ParsedFill[] {
  const byTradeId = new Map<string, ParsedFill>();
  for (const fill of [...first, ...tail]) {
    const existing = byTradeId.get(fill.tradeId);
    if (existing && JSON.stringify(existing) !== JSON.stringify(fill)) {
      throw new Error(
        `fills.data contains conflicting tradeId ${fill.tradeId}`,
      );
    }
    byTradeId.set(fill.tradeId, fill);
  }
  return [...byTradeId.values()];
}

function mergeOrders(
  first: AutoTraderExchangeOrder[],
  tail: AutoTraderExchangeOrder[],
): AutoTraderExchangeOrder[] {
  const byOrderId = new Map<string, AutoTraderExchangeOrder>();
  for (const order of [...first, ...tail]) {
    const existing = byOrderId.get(order.orderId);
    if (existing && JSON.stringify(existing) !== JSON.stringify(order)) {
      throw new Error(
        `history.data contains conflicting orderId ${order.orderId}`,
      );
    }
    byOrderId.set(order.orderId, order);
  }
  return [...byOrderId.values()];
}

function sameRows<T>(first: T[], second: T[]): boolean {
  const canonical = (rows: T[]) =>
    rows.map((row) => JSON.stringify(row)).sort();
  return JSON.stringify(canonical(first)) === JSON.stringify(canonical(second));
}

async function runReadOnlyQuery(
  kind: QueryKind,
  command: string,
  args: string[],
  runner: CommandRunner,
  env: NodeJS.ProcessEnv,
  timeoutMs: number | undefined,
): Promise<unknown> {
  let result: CommandResult;
  try {
    result = await runner(command, args, { env, timeoutMs });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${kind} query failed: ${message}`);
  }
  if (result.exitCode !== 0) {
    throw new Error(
      `${kind} query failed (${result.exitCode}): ${result.stderr.slice(0, 240)}`,
    );
  }
  return parseNormalizedResponse(result.stdout, kind);
}

function utcDayStart(now: Date): number {
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}

export async function readAutoTraderExchangeSnapshot(
  deps: AutoTraderExchangeDeps = {},
): Promise<AutoTraderExchangeSnapshot> {
  const runner = deps.runner ?? runCommand;
  const env = brokerCommandEnv(deps.env);
  if (!bitgetCredentialsPresent(env)) {
    throw new Error(
      "BITGET_API_KEY, BITGET_SECRET_KEY, and BITGET_PASSPHRASE are required",
    );
  }

  const clock = deps.now ?? (() => new Date());
  const exposureNow = clock();
  const exposureNowMs = exposureNow.getTime();
  if (!Number.isFinite(exposureNowMs)) {
    throw new Error("now must return a valid Date");
  }
  const pnlSince = deps.pnlSince ?? utcDayStart(exposureNow);
  const orderHistorySince = deps.orderHistorySince ?? utcDayStart(exposureNow);
  if (
    !Number.isSafeInteger(pnlSince) ||
    pnlSince < 0 ||
    pnlSince > exposureNowMs
  ) {
    throw new Error(
      "pnlSince must be a millisecond timestamp no later than now",
    );
  }
  if (
    !Number.isSafeInteger(orderHistorySince) ||
    orderHistorySince < 0 ||
    orderHistorySince > exposureNowMs
  ) {
    throw new Error(
      "orderHistorySince must be a millisecond timestamp no later than now",
    );
  }
  if (exposureNowMs - pnlSince > MAX_FILL_WINDOW_MS) {
    throw new Error("fill history since window cannot exceed seven days");
  }

  const invocation = defaultBgcInvocation();
  const prefix = [...invocation.argsPrefix, "--read-only"];
  const exposureQueries: Array<{ kind: QueryKind; args: string[] }> = [
    {
      kind: "account",
      args: [
        ...prefix,
        "account",
        "get_account_assets",
        "--accountType",
        "futures",
        "--productType",
        PRODUCT_TYPE,
        "--coin",
        MARGIN_COIN,
      ],
    },
    {
      kind: "pending",
      args: [
        ...prefix,
        "futures",
        "futures_get_orders",
        "--productType",
        PRODUCT_TYPE,
        "--status",
        "open",
        "--limit",
        String(PAGE_LIMIT),
      ],
    },
    {
      kind: "positions",
      args: [
        ...prefix,
        "futures",
        "futures_get_positions",
        "--productType",
        PRODUCT_TYPE,
        "--marginCoin",
        MARGIN_COIN,
      ],
    },
  ];

  const [account, pending, positions] = await Promise.all(
    exposureQueries.map(({ kind, args }) =>
      runReadOnlyQuery(
        kind,
        invocation.command,
        args,
        runner,
        env,
        deps.timeoutMs,
      ),
    ),
  );
  const ledgerNow = clock();
  const ledgerNowMs = ledgerNow.getTime();
  if (!Number.isFinite(ledgerNowMs) || ledgerNowMs < exposureNowMs) {
    throw new Error("now must not move backwards during exchange capture");
  }
  const range = (since: number, through: number) => [
    "--startTime",
    String(since),
    "--endTime",
    String(through),
    "--limit",
    String(PAGE_LIMIT),
  ];
  const ledgerQueries: Array<{ kind: QueryKind; args: string[] }> = [
    {
      kind: "fills",
      args: [
        ...prefix,
        "futures",
        "futures_get_fills",
        "--productType",
        PRODUCT_TYPE,
        ...range(pnlSince, ledgerNowMs),
      ],
    },
    {
      kind: "history",
      args: [
        ...prefix,
        "futures",
        "futures_get_orders",
        "--productType",
        PRODUCT_TYPE,
        "--status",
        "history",
        ...range(orderHistorySince, ledgerNowMs),
      ],
    },
  ];
  const [fills, history] = await Promise.all(
    ledgerQueries.map(({ kind, args }) =>
      runReadOnlyQuery(
        kind,
        invocation.command,
        args,
        runner,
        env,
        deps.timeoutMs,
      ),
    ),
  );
  const firstFills = parseFills(fills);
  const firstRecentOrders = parseOrders(history, "history.data");
  const firstPendingOrders = parseOrders(pending, "pending.data");
  const firstOpenPositions = parsePositions(positions);
  const captureEnd = clock();
  const captureEndMs = captureEnd.getTime();
  if (!Number.isFinite(captureEndMs) || captureEndMs < ledgerNowMs) {
    throw new Error("now must not move backwards during exchange capture");
  }
  const [finalPending, finalPositions] = await Promise.all(
    exposureQueries
      .slice(1)
      .map(({ kind, args }) =>
        runReadOnlyQuery(
          kind,
          invocation.command,
          args,
          runner,
          env,
          deps.timeoutMs,
        ),
      ),
  );
  const finalPendingOrders = parseOrders(finalPending, "pending.data");
  const finalOpenPositions = parsePositions(finalPositions);

  const tailQueries: Array<{ kind: QueryKind; args: string[] }> = [
    {
      kind: "fills",
      args: [
        ...prefix,
        "futures",
        "futures_get_fills",
        "--productType",
        PRODUCT_TYPE,
        ...range(ledgerNowMs, captureEndMs),
      ],
    },
    {
      kind: "history",
      args: [
        ...prefix,
        "futures",
        "futures_get_orders",
        "--productType",
        PRODUCT_TYPE,
        "--status",
        "history",
        ...range(ledgerNowMs, captureEndMs),
      ],
    },
  ];
  const [tailFills, tailHistory] = await Promise.all(
    tailQueries.map(({ kind, args }) =>
      runReadOnlyQuery(
        kind,
        invocation.command,
        args,
        runner,
        env,
        deps.timeoutMs,
      ),
    ),
  );
  const parsedFills = mergeFills(firstFills, parseFills(tailFills));
  const recentOrders = mergeOrders(
    firstRecentOrders,
    parseOrders(tailHistory, "history.data"),
  );

  const withinCapture = (createdAt: number) =>
    createdAt >= exposureNowMs && createdAt <= captureEndMs;
  const openActivityDuringCapture =
    !sameRows(firstPendingOrders, finalPendingOrders) ||
    !sameRows(firstOpenPositions, finalOpenPositions) ||
    recentOrders.some(
      (order) =>
        isOpeningTradeSide(order.tradeSide) && withinCapture(order.createdAt),
    ) ||
    parsedFills.some(
      (fill) =>
        isOpeningTradeSide(fill.tradeSide) && withinCapture(fill.createdAt),
    );
  const realizedPnlTotal = parsedFills.reduce(
    (total, fill) => total + fill.realizedPnlUSDT,
    0,
  );
  if (!Number.isFinite(realizedPnlTotal)) {
    throw new Error("fills.data produced non-finite realized USDT PnL");
  }
  const realizedPnlUSDT = Number(realizedPnlTotal.toFixed(12));

  return {
    equityUSDT: parseEquity(account),
    realizedPnlUSDT,
    pendingOrders: finalPendingOrders,
    openPositions: finalOpenPositions,
    recentOrders,
    captureStartedAt: exposureNow.toISOString(),
    openActivityDuringCapture,
    capturedAt: captureEnd.toISOString(),
  };
}
