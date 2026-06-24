import { describe, expect, it } from "vitest";
import { issuePassport, type AgentCandidate } from "../src/agentArena";
import {
  buildFuturesOrderPlan,
  extractOrderId,
  placeFuturesOrder,
  runCommand,
  type BrokerConfig,
} from "../src/liveStockBroker";

const candidate: AgentCandidate = {
  agentId: "quorum",
  name: "Quorum",
  thesis: "adversarial RWA trading desk",
  evidence: {
    paperTrades: 5,
    liveReadOk: true,
    hashChainOk: true,
    maxDrawdownPct: 0.02,
    ruleViolations: 0,
    debateRounds: 3,
    rejectedTrades: 2,
    backtest: {
      source: "artifacts/example-positive.json",
      variant: "gateDriven",
      returnPct: 1.2,
      sharpeAnnualized: 1.2,
      totalTrades: 25,
      alphaStatus: "positive",
      note: "positive fixture for live broker guard tests",
    },
  },
  controls: {
    riskGovernor: true,
    adversarialReview: true,
    liveNotionalCapUSDT: 20,
    confirmLive: true,
    killSwitch: true,
    isolatedMargin: true,
    maxLeverage: 1,
  },
};

const passport = issuePassport(candidate);

const baseConfig: BrokerConfig = {
  mode: "dry_run",
  passport,
  maxNotionalUSDT: 20,
  confirmLive: false,
  marginMode: "isolated",
  leverage: 1,
};

describe("live stock broker", () => {
  it("builds a Bitget Agent Hub futures order without executing in dry-run mode", async () => {
    const result = await placeFuturesOrder(
      {
        symbol: "NVDAUSDT",
        side: "open_long",
        size: 0.01,
        referencePrice: 209.62,
      },
      baseConfig,
    );

    expect(result.status).toBe("dry_run");
    expect(result.plan.args).toContain("futures_place_order");
    expect(result.plan.args).not.toContain("--paper-trading");
    expect(result.plan.command).toBe(process.execPath);
    expect(result.plan.args[0]).toContain("bitget-client");
    expect(result.plan.order).toMatchObject({
      symbol: "NVDAUSDT",
      productType: "USDT-FUTURES",
      marginMode: "isolated",
      marginCoin: "USDT",
      side: "buy",
      tradeSide: "open",
      orderType: "market",
      size: "0.01",
    });
  });

  it("translates semantic short and close sides into Bitget side/tradeSide fields", () => {
    expect(
      buildFuturesOrderPlan(
        {
          symbol: "NVDAUSDT",
          side: "open_short",
          size: 0.01,
          referencePrice: 209.62,
        },
        baseConfig,
      ).order,
    ).toMatchObject({ side: "sell", tradeSide: "open" });
    expect(
      buildFuturesOrderPlan(
        {
          symbol: "NVDAUSDT",
          side: "close_long",
          size: 0.01,
          referencePrice: 209.62,
        },
        baseConfig,
      ).order,
    ).toMatchObject({ side: "buy", tradeSide: "close" });
  });

  it("adds the paper-trading flag for demo trading submissions", async () => {
    const calls: {
      command: string;
      args: string[];
      envValue?: string;
      timeoutMs?: number;
    }[] = [];
    const result = await placeFuturesOrder(
      {
        symbol: "NVDAUSDT",
        side: "open_long",
        size: 0.01,
        referencePrice: 209.62,
        clientOid: "client-123",
      },
      {
        ...baseConfig,
        mode: "paper",
        timeoutMs: 12_000,
        env: {
          BITGET_API_KEY: "demo-key",
          BITGET_SECRET_KEY: "demo-secret",
          BITGET_PASSPHRASE: "demo-passphrase",
          TEST_CHILD_ENV: "propagated",
        },
      },
      async (command, args, options) => {
        calls.push({
          command,
          args,
          envValue: options?.env?.TEST_CHILD_ENV,
          timeoutMs: options?.timeoutMs,
        });
        return { exitCode: 0, stdout: '{"code":"00000"}', stderr: "" };
      },
    );

    expect(result.status).toBe("submitted");
    expect(result.plan.order.clientOid).toBe("client-123");
    expect(result.receipt).toMatchObject({
      clientOid: "client-123",
      status: "submitted",
    });
    expect(calls[0].command).toBe(process.execPath);
    expect(calls[0].args).toContain("--paper-trading");
    expect(calls[0].args.join(" ")).toContain("client-123");
    expect(calls[0].envValue).toBe("propagated");
    expect(calls[0].timeoutMs).toBe(12_000);
  });

  it("treats a non-00000 Bitget response code as a rejection, not a submission", async () => {
    await expect(
      placeFuturesOrder(
        {
          symbol: "NVDAUSDT",
          side: "open_long",
          size: 0.01,
          referencePrice: 209.62,
        },
        {
          ...baseConfig,
          mode: "paper",
          env: {
            BITGET_API_KEY: "demo-key",
            BITGET_SECRET_KEY: "demo-secret",
            BITGET_PASSPHRASE: "demo-passphrase",
          },
        },
        async () => ({
          exitCode: 0,
          stdout: '{"code":"40034","msg":"Unsupported operation"}',
          stderr: "",
        }),
      ),
    ).rejects.toThrow("Bitget rejected the order");
  });

  it("extracts the Bitget orderId from a place-order response", () => {
    expect(
      extractOrderId(
        '{"data":{"clientOid":"123","orderId":"1452624685207486465"}}',
      ),
    ).toBe("1452624685207486465");
    expect(extractOrderId("{}")).toBeNull();
  });

  it("polls a submitted order until a terminal filled receipt is proven", async () => {
    const calls: string[][] = [];
    const result = await placeFuturesOrder(
      {
        symbol: "BTCUSDT",
        side: "open_long",
        size: 0.0001,
        referencePrice: 64202,
        clientOid: "client-polled",
      },
      {
        ...baseConfig,
        mode: "paper",
        pollAttempts: 2,
        pollIntervalMs: 0,
        env: {
          BITGET_API_KEY: "demo-key",
          BITGET_SECRET_KEY: "demo-secret",
          BITGET_PASSPHRASE: "demo-passphrase",
        },
      },
      async (_command, args) => {
        calls.push(args);
        const tool = args[args.indexOf("futures") + 1];
        if (tool === "futures_place_order") {
          return {
            exitCode: 0,
            stdout:
              '{"code":"00000","data":{"clientOid":"client-polled","orderId":"1452633152483852289"}}',
            stderr: "",
          };
        }
        if (tool === "futures_get_orders") {
          return {
            exitCode: 0,
            stdout:
              '{"code":"00000","data":{"orderId":"1452633152483852289","status":"filled","priceAvg":"64200.5","baseVolume":"0.0001"}}',
            stderr: "",
          };
        }
        return {
          exitCode: 0,
          stdout:
            '{"code":"00000","data":[{"price":"64200.5","size":"0.0001","fee":"0.003","profit":"0"}]}',
          stderr: "",
        };
      },
    );

    expect(result.status).toBe("filled");
    expect(result.receipt).toMatchObject({
      orderId: "1452633152483852289",
      status: "filled",
      avgFillPrice: 64200.5,
      executedQty: 0.0001,
      feeUSDT: 0.003,
      realizedPnlUSDT: 0,
    });
    expect(result.receipt?.transitions.map((row) => row.status)).toEqual([
      "submitted",
      "filled",
    ]);
    expect(calls.map((args) => args[args.indexOf("futures") + 1])).toEqual([
      "futures_place_order",
      "futures_get_orders",
      "futures_get_fills",
    ]);
    expect(calls[1]).toContain("--orderId");
    expect(calls[1]).toContain("1452633152483852289");
  });

  it("blocks live mode without an explicitly confirmed licensed passport", () => {
    expect(() =>
      buildFuturesOrderPlan(
        {
          symbol: "NVDAUSDT",
          side: "open_long",
          size: 0.01,
          referencePrice: 209.62,
        },
        {
          ...baseConfig,
          mode: "live",
          confirmLive: false,
        },
      ),
    ).toThrow("explicit --confirm-live");
  });

  it("blocks live mode when the passport is not licensed", () => {
    const paperOnly = issuePassport({
      ...candidate,
      evidence: { ...candidate.evidence, liveReadOk: false },
    });
    expect(() =>
      buildFuturesOrderPlan(
        {
          symbol: "NVDAUSDT",
          side: "open_long",
          size: 0.01,
          referencePrice: 209.62,
        },
        {
          ...baseConfig,
          mode: "live",
          confirmLive: true,
          passport: paperOnly,
        },
      ),
    ).toThrow("LICENSED passport");
  });

  it("blocks orders above the notional cap", () => {
    expect(() =>
      buildFuturesOrderPlan(
        {
          symbol: "NVDAUSDT",
          side: "open_long",
          size: 0.2,
          referencePrice: 209.62,
        },
        baseConfig,
      ),
    ).toThrow("exceeds cap");
  });

  it("requires Bitget credentials before paper or live execution", async () => {
    await expect(
      placeFuturesOrder(
        {
          symbol: "NVDAUSDT",
          side: "open_long",
          size: 0.01,
          referencePrice: 209.62,
        },
        {
          ...baseConfig,
          mode: "paper",
        },
      ),
    ).rejects.toThrow("BITGET_API_KEY");
  });

  it("passes env to the child process", async () => {
    const result = await runCommand(
      process.execPath,
      ["-e", "console.log(process.env.GAPGUARD_CHILD_ENV)"],
      {
        env: { GAPGUARD_CHILD_ENV: "visible" },
        timeoutMs: 5_000,
      },
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("visible");
  });

  it("kills a child process after the configured timeout", async () => {
    const result = await runCommand(
      process.execPath,
      ["-e", "setTimeout(() => {}, 5000)"],
      { timeoutMs: 50 },
    );

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("timed out after 50ms");
  });
});
