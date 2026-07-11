import { describe, expect, it } from "vitest";
import {
  buildArenaCockpitData,
  mergeArenaDemoWithLiveBrokerRecords,
  parsePaperTradeRow,
  type GapGuardProofSummary,
} from "../src/arena-cockpit";
import { buildArenaDemo } from "../src/arena-demo";
import { sealArenaRecords, verifyArenaRecords } from "../src/arena-chain";
import type { RwaMarketReport } from "../src/rwa-market";

describe("arena cockpit data", () => {
  it("preserves live broker receipts when rebuilding demo Arena records", () => {
    const existing = sealArenaRecords([
      {
        ts: "2026-07-09T00:00:00.000Z",
        kind: "broker_order",
        agentId: "quorum",
        payload: { mode: "dry_run", status: "dry_run" },
      },
      {
        ts: "2026-07-10T00:00:00.000Z",
        kind: "broker_order",
        agentId: "quorum",
        payload: { mode: "live", trigger: "auto", status: "filled" },
      },
      {
        ts: "2026-07-10T01:00:00.000Z",
        kind: "broker_order",
        agentId: "quorum",
        payload: { label: "LIVE_RWA_ROUND_TRIP", open: {}, close: {} },
      },
    ]);
    const demo = sealArenaRecords([
      {
        ts: "2026-07-11T00:00:00.000Z",
        kind: "quorum_decision",
        agentId: "quorum",
        payload: { winningVote: "flat" },
      },
    ]);

    const merged = mergeArenaDemoWithLiveBrokerRecords(demo, existing);

    expect(verifyArenaRecords(merged).ok).toBe(true);
    expect(merged.map((record) => record.kind)).toEqual([
      "broker_order",
      "broker_order",
      "quorum_decision",
    ]);
    expect(merged.map((record) => record.payload)).toEqual([
      { mode: "live", trigger: "auto", status: "filled" },
      { label: "LIVE_RWA_ROUND_TRIP", open: {}, close: {} },
      { winningVote: "flat" },
    ]);
  });

  it("parses the fresh paper-order artifact shape", () => {
    const parsed = parsePaperTradeRow({
      ts: "2026-06-21T16:50:57.674Z",
      symbol: "BTCUSDT",
      mode: "paper",
      side: "open_long",
      size: 0.0001,
      referencePrice: 64202,
      orderId: "1452633152483852289",
      balanceBefore: 9999.35460371,
      balanceAfter: 9998.70945793,
      balanceDelta: -0.6451457800012577,
      result: { status: "submitted" },
    });

    expect(parsed).toMatchObject({
      symbol: "BTCUSDT",
      mode: "paper",
      side: "open_long",
      size: 0.0001,
      orderId: "1452633152483852289",
      balanceDelta: -0.6451457800012577,
      status: "submitted",
    });
  });

  it("parses the prior nested broker result shape", () => {
    const parsed = parsePaperTradeRow({
      ts: "2026-06-21T16:17:16.988Z",
      result: {
        status: "submitted",
        stdout: '{"code":"00000","data":{"orderId":"1452624685207486465"}}',
        plan: {
          mode: "paper",
          notionalUSDT: 6.4202,
          order: {
            symbol: "BTCUSDT",
            size: "0.0001",
            side: "buy",
            tradeSide: "open",
          },
        },
      },
    });

    expect(parsed).toMatchObject({
      symbol: "BTCUSDT",
      mode: "paper",
      side: "open_long",
      referencePrice: 64202,
      orderId: "1452624685207486465",
      status: "submitted",
    });
  });

  it("summarizes the paper-only desk, rejected bot, and gated broker path", async () => {
    const proof: GapGuardProofSummary = {
      ok: true,
      count: 5,
      finalHash: "abc123",
      proofScope: "synthetic_sample",
    };
    const rwaMarket: RwaMarketReport = {
      generatedAt: "2026-06-21T17:20:00.000Z",
      source: {
        baseUrl: "https://api.bitget.com",
        productType: "USDT-FUTURES",
        contracts: "/api/v2/mix/market/contracts",
        tickers: "/api/v2/mix/market/tickers",
      },
      defaultLiveSymbol: "NVDAUSDT",
      backupSymbol: "SOXLUSDT",
      liquidityLeader: "SOXLUSDT",
      selectedLiveSymbol: "NVDAUSDT",
      maxNotionalUSDT: 20,
      rows: [],
    };
    const data = buildArenaCockpitData(
      await buildArenaDemo(),
      null,
      proof,
      rwaMarket,
    );

    expect(data.status.licensedAgents + data.status.paperOnlyAgents).toBe(1);
    expect(data.status).toMatchObject({
      rejectedAgents: 1,
      paperEvidence: "missing",
      liveStatus: "default_off",
    });
    expect(data.broker.dryRunOrder).toBeNull();
    expect(data.broker.dryRunNotionalUSDT).toBeNull();
    expect(data.broker.liveGate).toContain("AUTO_TRADE_ENABLED=true");
    expect(data.broker.liveGate).toContain(
      "default daily realized-trade-PnL stop: 0.30 USDT including USDT fees",
    );
    expect(data.rwaMarket).toBe(rwaMarket);
    expect(data.gapguardProof).toBe(proof);
  });
});
