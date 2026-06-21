import { describe, expect, it } from "vitest";
import {
  buildArenaCockpitData,
  parsePaperTradeRow,
  type GapGuardProofSummary,
} from "../src/arena-cockpit";
import { buildArenaDemo } from "../src/arena-demo";

describe("arena cockpit data", () => {
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

  it("summarizes the licensed desk, rejected bot, and gated broker path", async () => {
    const proof: GapGuardProofSummary = {
      ok: true,
      count: 5,
      finalHash: "abc123",
      proofScope: "synthetic_sample",
    };
    const data = buildArenaCockpitData(await buildArenaDemo(), null, proof);

    expect(data.status).toMatchObject({
      licensedAgents: 1,
      rejectedAgents: 1,
      paperEvidence: "missing",
      liveStatus: "gated",
    });
    expect(data.broker.dryRunOrder.symbol).toBe("NVDAUSDT");
    expect(data.broker.liveGate).toContain("explicit --confirm-live");
    expect(data.gapguardProof).toBe(proof);
  });
});
