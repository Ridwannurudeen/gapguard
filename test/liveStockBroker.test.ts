import { describe, expect, it } from "vitest";
import { issuePassport, type AgentCandidate } from "../src/agentArena";
import {
  buildFuturesOrderPlan,
  extractOrderId,
  placeFuturesOrder,
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
    const calls: { command: string; args: string[] }[] = [];
    const result = await placeFuturesOrder(
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
      async (command, args) => {
        calls.push({ command, args });
        return { exitCode: 0, stdout: '{"code":"00000"}', stderr: "" };
      },
    );

    expect(result.status).toBe("submitted");
    expect(calls[0].command).toBe(process.execPath);
    expect(calls[0].args).toContain("--paper-trading");
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
});
