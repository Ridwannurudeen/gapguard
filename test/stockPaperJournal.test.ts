import { describe, expect, it } from "vitest";
import type { Candle } from "../src/gapEngine";
import {
  buildStockPaperJournal,
  toCsv,
  type JournalAssetInput,
} from "../src/stockPaperJournal";

function bar(ts: number, open: number, close: number): Candle {
  return {
    ts,
    open,
    high: Math.max(open, close),
    low: Math.min(open, close),
    close,
    volume: 1,
  };
}

const dayA = Date.UTC(2026, 4, 12, 16, 0, 0);
const dayB = Date.UTC(2026, 4, 13, 16, 0, 0);

function input(params: Partial<JournalAssetInput> = {}): JournalAssetInput {
  return {
    symbol: "AAPLUSDT",
    candles: [bar(dayA, 100, 100), bar(dayB, 102, 101)],
    gapThreshold: 0.004,
    costPerSide: 0.0005,
    slippageBps: 0,
    startEquity: 1000,
    gateCache: null,
    source: "test fixture",
    ...params,
  };
}

describe("stockPaperJournal", () => {
  it("records stock-paper fade rows with the Track 3 fields", () => {
    const rows = buildStockPaperJournal([input()]);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      evidenceLabel: "SIMULATED/PAPER_STOCK",
      timestamp: "2026-05-13T13:30:00.000Z",
      asset: "AAPLUSDT",
      action: "FADE",
      direction: "short",
      priceType: "entry",
      price: 102,
      quantity: expect.any(Number),
      accountBalanceChange: expect.any(Number),
      naiveAction: "FADE",
      naiveDirection: "short",
      source: "test fixture",
    });
  });

  it("records a zero-PnL stand-aside when the gate cache vetoes the trade", () => {
    const rows = buildStockPaperJournal([
      input({
        gateCache: {
          asset: "AAPLUSDT",
          model: "stub",
          verdicts: [
            {
              date: "2026-05-13",
              action: "STAND_ASIDE",
              fadeable: false,
              multiplier: 0,
              evidenceIds: [],
              returnPct: -1,
              rationale: "event risk",
            },
          ],
        },
      }),
    ]);

    expect(rows[0]).toMatchObject({
      action: "STAND_ASIDE",
      direction: "flat",
      quantity: 0,
      pnl: 0,
      accountBalanceChange: 0,
      accountBalanceBefore: 1000,
      accountBalanceAfter: 1000,
      naivePnl: expect.any(Number),
      rationale: "event risk",
    });
  });

  it("records a follow row when the gate says the catalyst should be respected", () => {
    const rows = buildStockPaperJournal([
      input({
        gateCache: {
          asset: "AAPLUSDT",
          model: "stub",
          verdicts: [
            {
              date: "2026-05-13",
              action: "FOLLOW",
              fadeable: false,
              multiplier: 0,
              evidenceIds: ["headline-1"],
              returnPct: -1,
              rationale: "momentum catalyst",
            },
          ],
        },
      }),
    ]);

    expect(rows[0]).toMatchObject({
      action: "FOLLOW",
      direction: "long",
      quantity: expect.any(Number),
      rationale: "momentum catalyst",
    });
  });

  it("writes a CSV with required judge-facing columns", () => {
    const csv = toCsv(buildStockPaperJournal([input()]));

    expect(csv.split(/\r?\n/)[0]).toContain(
      "timestamp,asset,action,direction,price",
    );
    expect(csv).toContain("accountBalanceChange");
    expect(csv).toContain("naivePnl");
  });
});
