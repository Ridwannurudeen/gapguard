import { describe, expect, it } from "vitest";
import { issuePassport, type AgentCandidate } from "../src/agentArena";
import { placeSimulatedFuturesOrder, simulateKillSwitch } from "../src/simBroker";

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

describe("sim broker", () => {
  it("fills a deterministic futures order against a price path", async () => {
    const result = await placeSimulatedFuturesOrder(
      {
        symbol: "NVDAUSDT",
        side: "open_long",
        size: 0.03,
        referencePrice: 209.62,
      },
      {
        mode: "dry_run",
        passport: issuePassport(candidate),
        maxNotionalUSDT: 20,
        confirmLive: false,
        marginMode: "isolated",
        leverage: 1,
      },
      {
        pricePath: [209.62, 204.4],
        startingBalanceUSDT: 10_000,
        ts: "2026-06-22T00:00:00.000Z",
      },
    );

    expect(result.status).toBe("dry_run");
    expect(result.plan.order).toMatchObject({
      symbol: "NVDAUSDT",
      side: "buy",
      tradeSide: "open",
      size: "0.03",
    });
    expect(result.fill).toMatchObject({
      ts: "2026-06-22T00:00:00.000Z",
      symbol: "NVDAUSDT",
      mode: "dry_run",
      side: "open_long",
      fillPrice: 209.62,
      exitPrice: 204.4,
      balanceBefore: 10_000,
    });
    expect(result.fill.balanceDelta).toBeCloseTo(-0.1566);
    expect(result.fill.executedQty).toBe(0.03);
    expect(result.fill.avgFillPrice).toBe(209.62);
    expect(result.fill.feeUSDT).toBe(0);
    expect(result.receipt).toMatchObject({
      status: "dry_run",
      executedQty: 0.03,
      avgFillPrice: 209.62,
    });
    expect(result.receipt?.realizedPnlUSDT).toBeCloseTo(-0.1566);
    expect(result.fill.orderId).toMatch(/^SIM-[a-f0-9]{16}$/);
  });

  it("keeps live broker notional caps in force offline", async () => {
    await expect(
      placeSimulatedFuturesOrder(
        {
          symbol: "NVDAUSDT",
          side: "open_long",
          size: 1,
          referencePrice: 209.62,
        },
        {
          mode: "dry_run",
          passport: issuePassport(candidate),
          maxNotionalUSDT: 20,
          confirmLive: false,
          marginMode: "isolated",
          leverage: 1,
        },
        { pricePath: [209.62, 204.4] },
      ),
    ).rejects.toThrow("exceeds cap");
  });

  it("cancels open orders and flattens position in the offline kill-switch", () => {
    const result = simulateKillSwitch({
      openOrders: [
        { orderId: "SIM-open-1", symbol: "NVDAUSDT" },
        { orderId: "SIM-open-2", symbol: "NVDAUSDT" },
      ],
      positionSize: 0.03,
      entryPrice: 209.62,
      markPrice: 204.4,
      balanceUSDT: 10_000,
    });

    expect(result.cancelledOrderIds).toEqual(["SIM-open-1", "SIM-open-2"]);
    expect(result.flattenOrder).toMatchObject({
      symbol: "NVDAUSDT",
      side: "sell",
      executedQty: 0.03,
      avgFillPrice: 204.4,
    });
    expect(result.flattenOrder?.realizedPnlUSDT).toBeCloseTo(-0.1566);
    expect(result.finalPositionSize).toBe(0);
    expect(result.finalBalanceUSDT).toBeCloseTo(9999.8434);
  });
});
