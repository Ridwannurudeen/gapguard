import { describe, expect, it } from "vitest";
import { parseBrokerCliArgs } from "../src/broker-cli";

describe("broker cli", () => {
  it("defaults to a safe dry-run order", () => {
    expect(parseBrokerCliArgs([], {})).toMatchObject({
      mode: "dry_run",
      symbol: "NVDAUSDT",
      size: 0.03,
      referencePrice: 209.62,
      maxNotionalUSDT: 20,
      confirmLive: false,
      out: "artifacts/order-dry-run.jsonl",
    });
  });

  it("parses paper mode and explicit order fields", () => {
    expect(
      parseBrokerCliArgs([
        "--mode",
        "paper",
        "--symbol",
        "SOXLUSDT",
        "--side",
        "open_short",
        "--size",
        "0.02",
        "--reference-price",
        "284.5",
        "--max-notional",
        "10",
      ]),
    ).toMatchObject({
      mode: "paper",
      symbol: "SOXLUSDT",
      side: "open_short",
      size: 0.02,
      referencePrice: 284.5,
      maxNotionalUSDT: 10,
      out: "artifacts/paper-trades.jsonl",
    });
  });

  it("requires explicit live confirmation as a boolean flag", () => {
    expect(
      parseBrokerCliArgs(["--mode", "live", "--confirm-live"]).confirmLive,
    ).toBe(true);
  });

  it("rejects unknown arguments", () => {
    expect(() => parseBrokerCliArgs(["--unknown"])).toThrow("unknown argument");
  });

  it("defaults paper mode to a demo-supported crypto symbol", () => {
    // Bitget Demo lists crypto perps only, so the RWA default would be rejected.
    expect(parseBrokerCliArgs(["--mode", "paper"], {})).toMatchObject({
      symbol: "BTCUSDT",
      size: 0.0001,
      referencePrice: 64202,
    });
  });

  it("lets an explicit symbol win in paper mode", () => {
    expect(
      parseBrokerCliArgs(["--mode", "paper", "--symbol", "ETHUSDT"], {}).symbol,
    ).toBe("ETHUSDT");
  });

  it("defaults the stop-loss and take-profit to the constitution's overnight-loss cap", () => {
    const args = parseBrokerCliArgs([]);
    expect(args.stopLossPct).toBeCloseTo(0.015);
    expect(args.takeProfitPct).toBeCloseTo(0.015);
  });

  it("lets an explicit bracket percentage override the default", () => {
    const args = parseBrokerCliArgs([
      "--stop-loss-pct",
      "0.02",
      "--take-profit-pct",
      "0.03",
    ]);
    expect(args.stopLossPct).toBeCloseTo(0.02);
    expect(args.takeProfitPct).toBeCloseTo(0.03);
  });

  it("treats an explicit 0 as opting out of that bracket leg", () => {
    const args = parseBrokerCliArgs([
      "--stop-loss-pct",
      "0",
      "--take-profit-pct",
      "0",
    ]);
    expect(args.stopLossPct).toBeNull();
    expect(args.takeProfitPct).toBeNull();
  });
});
