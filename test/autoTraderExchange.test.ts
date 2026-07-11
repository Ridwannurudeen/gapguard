import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  readAutoTraderExchangeSnapshot,
  type AutoTraderExchangeDeps,
} from "../src/autoTraderExchange";
import type {
  CommandResult,
  CommandRunner,
  CommandRunnerOptions,
} from "../src/liveStockBroker";

type QueryKind = "account" | "pending" | "positions" | "fills" | "history";

interface SeenCall {
  command: string;
  args: string[];
  options: CommandRunnerOptions | undefined;
}

const NOW = new Date("2026-07-10T12:34:56.789Z");
const LEDGER_NOW = new Date("2026-07-10T12:35:01.000Z");
const CAPTURE_END = new Date("2026-07-10T12:35:02.000Z");
const DAY_START = Date.parse("2026-07-10T00:00:00.000Z");
const ENDPOINTS: Record<QueryKind, string> = {
  account: "GET /api/v2/mix/account/accounts",
  pending: "GET /api/v2/mix/order/orders-pending",
  positions: "GET /api/v2/mix/position/all-position",
  fills: "GET /api/v2/mix/order/fill-history",
  history: "GET /api/v2/mix/order/orders-history",
};

const ENV: NodeJS.ProcessEnv = {
  BITGET_API_KEY: "test-key",
  BITGET_SECRET_KEY: "test-secret",
  BITGET_PASSPHRASE: "test-passphrase",
  BITGET_API_BASE_URL: "http://127.0.0.1:1",
  SNAPSHOT_TEST_MARKER: "kept",
};

function normalized(endpoint: string, data: unknown): string {
  return JSON.stringify({
    endpoint,
    requestTime: "2026-07-10T12:34:56.000Z",
    data,
  });
}

function order(index: number) {
  return {
    orderId: `order-${index}`,
    clientOid: `client-${index}`,
    symbol: "AAPLUSDT",
    status: "filled",
    tradeSide: "open",
    cTime: String(NOW.getTime() - index),
  };
}

function fill(index: number) {
  return {
    tradeId: `trade-${index}`,
    marginCoin: "USDT",
    tradeSide: "close",
    cTime: String(NOW.getTime() - index),
    profit: "0",
    feeDetail: [{ feeCoin: "USDT", totalFee: "0" }],
  };
}

function validResults(): Record<QueryKind, CommandResult> {
  return {
    account: {
      exitCode: 0,
      stdout: normalized(ENDPOINTS.account, [
        { marginCoin: "USDT", accountEquity: "19.75" },
      ]),
      stderr: "",
    },
    pending: {
      exitCode: 0,
      stdout: normalized(ENDPOINTS.pending, {
        entrustedList: [
          {
            orderId: "pending-1",
            clientOid: "gg-pending-1",
            symbol: "AAPLUSDT",
            status: "live",
            tradeSide: "open",
            cTime: String(NOW.getTime() - 10),
          },
        ],
        endId: "pending-1",
      }),
      stderr: "",
    },
    positions: {
      exitCode: 0,
      stdout: normalized(ENDPOINTS.positions, [
        {
          marginCoin: "USDT",
          symbol: "AAPLUSDT",
          holdSide: "long",
          total: "0",
          openDelegateSize: "0",
        },
        {
          marginCoin: "USDT",
          symbol: "NVDAUSDT",
          holdSide: "short",
          total: "0.01",
          openDelegateSize: "0",
        },
        {
          marginCoin: "USDT",
          symbol: "TSLAUSDT",
          holdSide: "long",
          total: "0",
          openDelegateSize: "0.02",
        },
      ]),
      stderr: "",
    },
    fills: {
      exitCode: 0,
      stdout: normalized(ENDPOINTS.fills, {
        fillList: [
          {
            tradeId: "trade-1",
            marginCoin: "USDT",
            tradeSide: "close",
            cTime: String(NOW.getTime() - 1),
            profit: "2.5",
            feeDetail: [
              { feeCoin: "USDT", totalFee: "-0.1" },
              { feeCoin: "USDT", totalFee: "0.02" },
            ],
          },
          {
            tradeId: "trade-2",
            marginCoin: "USDT",
            tradeSide: "close",
            cTime: String(NOW.getTime() - 2),
            profit: "-0.5",
            feeDetail: [{ feeCoin: "USDT", totalFee: "-0.03" }],
          },
        ],
        endId: "trade-2",
      }),
      stderr: "",
    },
    history: {
      exitCode: 0,
      stdout: normalized(ENDPOINTS.history, {
        entrustedList: [order(1)],
        endId: "order-1",
      }),
      stderr: "",
    },
  };
}

function identifyQuery(args: string[]): QueryKind {
  if (args.includes("get_account_assets")) return "account";
  if (args.includes("futures_get_positions")) return "positions";
  if (args.includes("futures_get_fills")) return "fills";
  if (args.includes("futures_get_orders")) {
    const statusIndex = args.indexOf("--status");
    return args[statusIndex + 1] === "history" ? "history" : "pending";
  }
  throw new Error(`unexpected test command: ${args.join(" ")}`);
}

function injectedRunner(
  overrides: Partial<Record<QueryKind, CommandResult>> = {},
): { runner: CommandRunner; calls: SeenCall[] } {
  const calls: SeenCall[] = [];
  const results = { ...validResults(), ...overrides };
  return {
    calls,
    runner: async (command, args, options) => {
      calls.push({ command, args, options });
      return results[identifyQuery(args)];
    },
  };
}

function deps(runner: CommandRunner): AutoTraderExchangeDeps {
  return { runner, env: ENV, now: () => NOW, timeoutMs: 12_000 };
}

describe("auto trader exchange reconciliation", () => {
  it("runs the nine exact read-only queries and returns a typed snapshot", async () => {
    const { runner, calls } = injectedRunner();
    const snapshot = await readAutoTraderExchangeSnapshot(deps(runner));
    const client = join(
      process.cwd(),
      "node_modules",
      "bitget-client",
      "dist",
      "index.js",
    );
    const prefix = [client, "--read-only"];

    expect(calls.map(({ command }) => command)).toEqual(
      Array(9).fill(process.execPath),
    );
    expect(calls.map(({ args }) => args)).toEqual([
      [
        ...prefix,
        "account",
        "get_account_assets",
        "--accountType",
        "futures",
        "--productType",
        "USDT-FUTURES",
        "--coin",
        "USDT",
      ],
      [
        ...prefix,
        "futures",
        "futures_get_orders",
        "--productType",
        "USDT-FUTURES",
        "--status",
        "open",
        "--limit",
        "100",
      ],
      [
        ...prefix,
        "futures",
        "futures_get_positions",
        "--productType",
        "USDT-FUTURES",
        "--marginCoin",
        "USDT",
      ],
      [
        ...prefix,
        "futures",
        "futures_get_fills",
        "--productType",
        "USDT-FUTURES",
        "--startTime",
        String(DAY_START),
        "--endTime",
        String(NOW.getTime()),
        "--limit",
        "100",
      ],
      [
        ...prefix,
        "futures",
        "futures_get_orders",
        "--productType",
        "USDT-FUTURES",
        "--status",
        "history",
        "--startTime",
        String(DAY_START),
        "--endTime",
        String(NOW.getTime()),
        "--limit",
        "100",
      ],
      [
        ...prefix,
        "futures",
        "futures_get_orders",
        "--productType",
        "USDT-FUTURES",
        "--status",
        "open",
        "--limit",
        "100",
      ],
      [
        ...prefix,
        "futures",
        "futures_get_positions",
        "--productType",
        "USDT-FUTURES",
        "--marginCoin",
        "USDT",
      ],
      [
        ...prefix,
        "futures",
        "futures_get_fills",
        "--productType",
        "USDT-FUTURES",
        "--startTime",
        String(NOW.getTime()),
        "--endTime",
        String(NOW.getTime()),
        "--limit",
        "100",
      ],
      [
        ...prefix,
        "futures",
        "futures_get_orders",
        "--productType",
        "USDT-FUTURES",
        "--status",
        "history",
        "--startTime",
        String(NOW.getTime()),
        "--endTime",
        String(NOW.getTime()),
        "--limit",
        "100",
      ],
    ]);
    expect(calls.every(({ args }) => args.includes("--read-only"))).toBe(true);
    expect(
      calls.every(
        ({ options }) =>
          options?.timeoutMs === 12_000 &&
          options.env?.SNAPSHOT_TEST_MARKER === "kept" &&
          options.env?.BITGET_API_BASE_URL === undefined,
      ),
    ).toBe(true);
    expect(snapshot).toEqual({
      equityUSDT: 19.75,
      realizedPnlUSDT: 1.89,
      pendingOrders: [
        {
          orderId: "pending-1",
          clientOid: "gg-pending-1",
          symbol: "AAPLUSDT",
          status: "live",
          tradeSide: "open",
          createdAt: NOW.getTime() - 10,
        },
      ],
      openPositions: [
        {
          marginCoin: "USDT",
          symbol: "NVDAUSDT",
          holdSide: "short",
          total: 0.01,
          openDelegateSize: 0,
        },
        {
          marginCoin: "USDT",
          symbol: "TSLAUSDT",
          holdSide: "long",
          total: 0,
          openDelegateSize: 0.02,
        },
      ],
      recentOrders: [
        {
          orderId: "order-1",
          clientOid: "client-1",
          symbol: "AAPLUSDT",
          status: "filled",
          tradeSide: "open",
          createdAt: NOW.getTime() - 1,
        },
      ],
      captureStartedAt: NOW.toISOString(),
      openActivityDuringCapture: false,
      capturedAt: NOW.toISOString(),
    });
  });

  it("recomputes realized PnL idempotently from the same daily fills", async () => {
    const { runner } = injectedRunner();
    const first = await readAutoTraderExchangeSnapshot(deps(runner));
    const second = await readAutoTraderExchangeSnapshot(deps(runner));

    expect(first.realizedPnlUSDT).toBe(1.89);
    expect(second.realizedPnlUSDT).toBe(first.realizedPnlUSDT);
  });

  it("treats Bitget's null empty fill page as zero fills", async () => {
    const { runner } = injectedRunner({
      fills: {
        exitCode: 0,
        stdout: normalized(ENDPOINTS.fills, {
          fillList: null,
          endId: null,
        }),
        stderr: "",
      },
    });

    const snapshot = await readAutoTraderExchangeSnapshot(deps(runner));

    expect(snapshot.realizedPnlUSDT).toBe(0);
    expect(snapshot.openActivityDuringCapture).toBe(false);
  });

  it.each(["pending", "history"] as const)(
    "treats Bitget's null empty %s order page as no orders",
    async (kind) => {
      const { runner } = injectedRunner({
        [kind]: {
          exitCode: 0,
          stdout: normalized(ENDPOINTS[kind], {
            entrustedList: null,
            endId: null,
          }),
          stderr: "",
        },
      });

      const snapshot = await readAutoTraderExchangeSnapshot(deps(runner));

      expect(
        kind === "pending" ? snapshot.pendingOrders : snapshot.recentOrders,
      ).toEqual([]);
    },
  );

  it.each<{
    kind: Extract<QueryKind, "fills" | "pending" | "history">;
    data: unknown;
    expected: string;
  }>([
    {
      kind: "fills",
      data: { fillList: null, endId: "unexpected-cursor" },
      expected: "may be null only",
    },
    {
      kind: "pending",
      data: { entrustedList: null, endId: "unexpected-cursor" },
      expected: "may be null only",
    },
    {
      kind: "fills",
      data: { fillList: [fill(1)], endId: null },
      expected: "endId",
    },
    {
      kind: "history",
      data: { entrustedList: [order(1)], endId: null },
      expected: "endId",
    },
  ])(
    "rejects an inconsistent null page for $kind",
    async ({ kind, data, expected }) => {
      const { runner } = injectedRunner({
        [kind]: {
          exitCode: 0,
          stdout: normalized(ENDPOINTS[kind], data),
          stderr: "",
        },
      });

      await expect(
        readAutoTraderExchangeSnapshot(deps(runner)),
      ).rejects.toThrow(expected);
    },
  );

  it("keeps daily PnL at UTC midnight while extending order history across midnight", async () => {
    const { runner, calls } = injectedRunner();
    const orderHistorySince = Date.parse("2026-07-09T23:45:00.000Z");
    await readAutoTraderExchangeSnapshot({
      ...deps(runner),
      pnlSince: DAY_START,
      orderHistorySince,
    });

    const fills = calls.find(
      (call) => identifyQuery(call.args) === "fills",
    )?.args;
    const history = calls.find(
      (call) => identifyQuery(call.args) === "history",
    )?.args;
    expect(fills?.[fills.indexOf("--startTime") + 1]).toBe(String(DAY_START));
    expect(history?.[history.indexOf("--startTime") + 1]).toBe(
      String(orderHistorySince),
    );
  });

  it("captures the ledger only after exposure queries settle", async () => {
    const results = validResults();
    const calls: SeenCall[] = [];
    let positionsSettled = false;
    let nowCalls = 0;
    const runner: CommandRunner = async (command, args, options) => {
      calls.push({ command, args, options });
      const kind = identifyQuery(args);
      if (kind === "positions") {
        await Promise.resolve();
        positionsSettled = true;
      }
      if ((kind === "fills" || kind === "history") && !positionsSettled) {
        throw new Error("ledger queried before positions settled");
      }
      return results[kind];
    };

    const snapshot = await readAutoTraderExchangeSnapshot({
      ...deps(runner),
      now: () => (nowCalls++ === 0 ? NOW : LEDGER_NOW),
    });

    const ledgerCalls = calls.filter(({ args }) => {
      const kind = identifyQuery(args);
      return kind === "fills" || kind === "history";
    });
    expect(ledgerCalls).toHaveLength(4);
    for (const { args } of ledgerCalls) {
      expect(args[args.indexOf("--endTime") + 1]).toBe(
        String(LEDGER_NOW.getTime()),
      );
    }
    expect(snapshot.capturedAt).toBe(LEDGER_NOW.toISOString());
  });

  it("takes the capture boundary before the final pending-order read", async () => {
    let pendingReads = 0;
    let boundaryTaken = false;
    const emptyList = (kind: "pending" | "history"): CommandResult => ({
      exitCode: 0,
      stdout: normalized(ENDPOINTS[kind], {
        entrustedList: [],
        endId: "",
      }),
      stderr: "",
    });
    const emptyFills: CommandResult = {
      exitCode: 0,
      stdout: normalized(ENDPOINTS.fills, { fillList: [], endId: "" }),
      stderr: "",
    };
    const runner: CommandRunner = async (_command, args) => {
      const kind = identifyQuery(args);
      if (kind === "account") return validResults().account;
      if (kind === "positions") {
        return {
          exitCode: 0,
          stdout: normalized(ENDPOINTS.positions, []),
          stderr: "",
        };
      }
      if (kind === "pending") {
        pendingReads += 1;
        if (pendingReads === 1) return emptyList("pending");
        if (!boundaryTaken) {
          throw new Error("final pending read started before capture boundary");
        }
        return {
          exitCode: 0,
          stdout: normalized(ENDPOINTS.pending, {
            entrustedList: [
              {
                orderId: "external-pending",
                clientOid: "external-client",
                symbol: "AAPLUSDT",
                status: "live",
                tradeSide: "open",
                cTime: String(CAPTURE_END.getTime() - 1),
              },
            ],
            endId: "external-pending",
          }),
          stderr: "",
        };
      }
      return kind === "fills" ? emptyFills : emptyList("history");
    };
    let nowCalls = 0;

    const snapshot = await readAutoTraderExchangeSnapshot({
      ...deps(runner),
      now: () => {
        nowCalls += 1;
        if (nowCalls === 1) return NOW;
        if (nowCalls === 2) return LEDGER_NOW;
        boundaryTaken = true;
        return CAPTURE_END;
      },
    });

    expect(snapshot.capturedAt).toBe(CAPTURE_END.toISOString());
    expect(snapshot.pendingOrders).toHaveLength(1);
    expect(snapshot.pendingOrders[0]?.orderId).toBe("external-pending");
    expect(snapshot.openActivityDuringCapture).toBe(true);
  });

  it("captures an external open and close completed while the first ledger reads are in flight", async () => {
    const calls: SeenCall[] = [];
    let mainLedgerCalls = 0;
    let releaseMainLedger: (() => void) | undefined;
    const mainLedgerBarrier = new Promise<void>((resolve) => {
      releaseMainLedger = resolve;
    });
    const emptyPending: CommandResult = {
      exitCode: 0,
      stdout: normalized(ENDPOINTS.pending, {
        entrustedList: [],
        endId: "",
      }),
      stderr: "",
    };
    const emptyPositions: CommandResult = {
      exitCode: 0,
      stdout: normalized(ENDPOINTS.positions, []),
      stderr: "",
    };
    const baselineFill = {
      tradeId: "baseline-trade",
      marginCoin: "USDT",
      tradeSide: "close",
      cTime: String(LEDGER_NOW.getTime()),
      profit: "1",
      feeDetail: [{ feeCoin: "USDT", totalFee: "-0.1" }],
    };
    const baselineOrder = {
      orderId: "baseline-order",
      clientOid: "baseline-client",
      symbol: "AAPLUSDT",
      status: "filled",
      tradeSide: "close",
      cTime: String(LEDGER_NOW.getTime()),
    };
    const tailFills: CommandResult = {
      exitCode: 0,
      stdout: normalized(ENDPOINTS.fills, {
        fillList: [
          baselineFill,
          {
            tradeId: "external-open-fill",
            marginCoin: "USDT",
            tradeSide: "open",
            cTime: String(LEDGER_NOW.getTime() + 250),
            profit: "0",
            feeDetail: [{ feeCoin: "USDT", totalFee: "-0.01" }],
          },
          {
            tradeId: "external-close-fill",
            marginCoin: "USDT",
            tradeSide: "close",
            cTime: String(LEDGER_NOW.getTime() + 500),
            profit: "0.5",
            feeDetail: [{ feeCoin: "USDT", totalFee: "-0.01" }],
          },
        ],
        endId: "external-close-fill",
      }),
      stderr: "",
    };
    const tailHistory: CommandResult = {
      exitCode: 0,
      stdout: normalized(ENDPOINTS.history, {
        entrustedList: [
          baselineOrder,
          {
            orderId: "external-open-order",
            clientOid: "external-open-client",
            symbol: "AAPLUSDT",
            status: "filled",
            tradeSide: "open",
            cTime: String(LEDGER_NOW.getTime() + 200),
          },
          {
            orderId: "external-close-order",
            clientOid: "external-close-client",
            symbol: "AAPLUSDT",
            status: "filled",
            tradeSide: "close",
            cTime: String(LEDGER_NOW.getTime() + 600),
          },
        ],
        endId: "external-close-order",
      }),
      stderr: "",
    };
    const runner: CommandRunner = async (command, args, options) => {
      calls.push({ command, args, options });
      const kind = identifyQuery(args);
      if (kind === "pending") return emptyPending;
      if (kind === "positions") return emptyPositions;
      if (kind === "account") return validResults().account;

      const startTime = Number(args[args.indexOf("--startTime") + 1]);
      if (startTime === DAY_START) {
        mainLedgerCalls += 1;
        if (mainLedgerCalls === 2) releaseMainLedger?.();
        await mainLedgerBarrier;
        if (kind === "fills") {
          return {
            exitCode: 0,
            stdout: normalized(ENDPOINTS.fills, {
              fillList: [baselineFill],
              endId: "baseline-trade",
            }),
            stderr: "",
          };
        }
        return {
          exitCode: 0,
          stdout: normalized(ENDPOINTS.history, {
            entrustedList: [baselineOrder],
            endId: "baseline-order",
          }),
          stderr: "",
        };
      }
      return kind === "fills" ? tailFills : tailHistory;
    };
    let nowCalls = 0;

    const snapshot = await readAutoTraderExchangeSnapshot({
      ...deps(runner),
      now: () => [NOW, LEDGER_NOW, CAPTURE_END][nowCalls++] ?? CAPTURE_END,
    });

    expect(calls).toHaveLength(9);
    const tailLedgerCalls = calls.filter(({ args }) => {
      const startIndex = args.indexOf("--startTime");
      return (
        startIndex >= 0 && args[startIndex + 1] === String(LEDGER_NOW.getTime())
      );
    });
    expect(tailLedgerCalls).toHaveLength(2);
    expect(
      tailLedgerCalls.map(({ args }) => args[args.indexOf("--endTime") + 1]),
    ).toEqual(Array(2).fill(String(CAPTURE_END.getTime())));
    expect(snapshot.pendingOrders).toEqual([]);
    expect(snapshot.openPositions).toEqual([]);
    expect(snapshot.realizedPnlUSDT).toBe(1.38);
    expect(snapshot.recentOrders.map(({ orderId }) => orderId)).toEqual([
      "baseline-order",
      "external-open-order",
      "external-close-order",
    ]);
    expect(snapshot.openActivityDuringCapture).toBe(true);
    expect(snapshot.capturedAt).toBe(CAPTURE_END.toISOString());
  });

  it.each([
    ["history", "buy_single"],
    ["fills", "sell_single"],
  ] as const)(
    "signals an opening %s record with one-way side %s created after exposure capture began",
    async (kind, tradeSide) => {
      const duringCapture = NOW.getTime() + 1_000;
      const override: Partial<Record<QueryKind, CommandResult>> =
        kind === "history"
          ? {
              history: {
                exitCode: 0,
                stdout: normalized(ENDPOINTS.history, {
                  entrustedList: [
                    {
                      ...order(1),
                      cTime: String(duringCapture),
                      tradeSide,
                    },
                  ],
                  endId: "order-1",
                }),
                stderr: "",
              },
            }
          : {
              fills: {
                exitCode: 0,
                stdout: normalized(ENDPOINTS.fills, {
                  fillList: [
                    {
                      ...fill(1),
                      symbol: "AAPLUSDT",
                      orderId: "order-1",
                      tradeSide,
                      cTime: String(duringCapture),
                    },
                  ],
                  endId: "trade-1",
                }),
                stderr: "",
              },
            };
      const { runner } = injectedRunner(override);
      let nowCalls = 0;

      const snapshot = await readAutoTraderExchangeSnapshot({
        ...deps(runner),
        now: () => (nowCalls++ === 0 ? NOW : LEDGER_NOW),
      });

      expect(snapshot.captureStartedAt).toBe(NOW.toISOString());
      expect(snapshot.openActivityDuringCapture).toBe(true);
    },
  );

  it("requires credentials before invoking the runner", async () => {
    let calls = 0;
    await expect(
      readAutoTraderExchangeSnapshot({
        runner: async () => {
          calls += 1;
          return { exitCode: 0, stdout: "", stderr: "" };
        },
        env: {
          BITGET_API_KEY: "",
          BITGET_SECRET_KEY: "",
          BITGET_PASSPHRASE: "",
        },
        now: () => NOW,
      }),
    ).rejects.toThrow("BITGET_API_KEY");
    expect(calls).toBe(0);
  });

  it("fails closed when any read-only command fails", async () => {
    const { runner } = injectedRunner({
      positions: { exitCode: 1, stdout: "", stderr: "permission denied" },
    });

    await expect(readAutoTraderExchangeSnapshot(deps(runner))).rejects.toThrow(
      "positions query failed (1): permission denied",
    );
  });

  it.each([
    ["invalid JSON", "not-json"],
    [
      "the raw Bitget envelope",
      JSON.stringify({ code: "00000", data: [], msg: "success" }),
    ],
    [
      "a normalized envelope with an extra key",
      JSON.stringify({
        endpoint: ENDPOINTS.account,
        requestTime: NOW.toISOString(),
        data: [],
        code: "00000",
      }),
    ],
  ])("rejects %s instead of loosely parsing stdout", async (_label, stdout) => {
    const { runner } = injectedRunner({
      account: { exitCode: 0, stdout, stderr: "" },
    });

    await expect(readAutoTraderExchangeSnapshot(deps(runner))).rejects.toThrow(
      "account response",
    );
  });

  it.each([undefined, "0", "-1", "not-a-number"])(
    "rejects missing or nonpositive USDT account equity (%s)",
    async (accountEquity) => {
      const { runner } = injectedRunner({
        account: {
          exitCode: 0,
          stdout: normalized(ENDPOINTS.account, [
            { marginCoin: "USDT", accountEquity },
          ]),
          stderr: "",
        },
      });

      await expect(
        readAutoTraderExchangeSnapshot(deps(runner)),
      ).rejects.toThrow("accountEquity");
    },
  );

  it("rejects malformed endpoint data instead of treating it as empty", async () => {
    const { runner } = injectedRunner({
      pending: {
        exitCode: 0,
        stdout: normalized(ENDPOINTS.pending, []),
        stderr: "",
      },
    });

    await expect(readAutoTraderExchangeSnapshot(deps(runner))).rejects.toThrow(
      "pending.data",
    );
  });

  it.each(["pending", "fills", "history"] as const)(
    "rejects a %s page at the installed CLI's unpageable limit",
    async (kind) => {
      const data =
        kind === "fills"
          ? {
              fillList: Array.from({ length: 100 }, (_, index) => fill(index)),
              endId: "next",
            }
          : {
              entrustedList: Array.from({ length: 100 }, (_, index) =>
                order(index),
              ),
              endId: "next",
            };
      const { runner } = injectedRunner({
        [kind]: {
          exitCode: 0,
          stdout: normalized(ENDPOINTS[kind], data),
          stderr: "",
        },
      });

      await expect(
        readAutoTraderExchangeSnapshot(deps(runner)),
      ).rejects.toThrow("may be incomplete");
    },
  );

  it("rejects explicit continuation markers even below the row limit", async () => {
    const { runner } = injectedRunner({
      history: {
        exitCode: 0,
        stdout: normalized(ENDPOINTS.history, {
          entrustedList: [order(1)],
          endId: "order-1",
          hasMore: true,
        }),
        stderr: "",
      },
    });

    await expect(readAutoTraderExchangeSnapshot(deps(runner))).rejects.toThrow(
      "continuation marker",
    );
  });

  it("rejects a fill window over Bitget's documented seven-day maximum", async () => {
    let calls = 0;
    const since = NOW.getTime() - 7 * 24 * 60 * 60 * 1000 - 1;

    await expect(
      readAutoTraderExchangeSnapshot({
        ...deps(async () => {
          calls += 1;
          return { exitCode: 0, stdout: "", stderr: "" };
        }),
        pnlSince: since,
      }),
    ).rejects.toThrow("seven days");
    expect(calls).toBe(0);
  });

  it("fails closed when a non-USDT fee cannot be included in USDT PnL", async () => {
    const { runner } = injectedRunner({
      fills: {
        exitCode: 0,
        stdout: normalized(ENDPOINTS.fills, {
          fillList: [
            {
              tradeId: "trade-bgb",
              marginCoin: "USDT",
              tradeSide: "close",
              cTime: String(NOW.getTime() - 1),
              profit: "1",
              feeDetail: [{ feeCoin: "BGB", totalFee: "-0.1" }],
            },
          ],
          endId: "trade-bgb",
        }),
        stderr: "",
      },
    });

    await expect(readAutoTraderExchangeSnapshot(deps(runner))).rejects.toThrow(
      "non-USDT fee",
    );
  });
});
