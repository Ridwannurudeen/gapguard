import { describe, expect, it } from "vitest";
import { parseBrokerCliArgs } from "../src/broker-cli";

describe("broker cli", () => {
  it("defaults to a safe dry-run order", () => {
    expect(parseBrokerCliArgs([], {})).toMatchObject({
      mode: "dry_run",
      symbol: "NVDAUSDT",
      size: 0.01,
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
    expect(parseBrokerCliArgs(["--mode", "paper"], {}).symbol).toBe("BTCUSDT");
  });

  it("lets an explicit symbol win in paper mode", () => {
    expect(
      parseBrokerCliArgs(["--mode", "paper", "--symbol", "ETHUSDT"], {}).symbol,
    ).toBe("ETHUSDT");
  });
});
