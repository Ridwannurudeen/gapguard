import { describe, expect, it } from "vitest";
import {
  buildBalanceArgs,
  parseAvailable,
  parseBalanceArgs,
  readFuturesAvailable,
} from "../src/broker-balance";

describe("broker balance cli", () => {
  it("defaults to a read-only paper futures balance query", () => {
    expect(parseBalanceArgs([], {})).toEqual({
      mode: "paper",
      coin: "USDT",
      productType: "USDT-FUTURES",
    });
  });

  it("parses live mode and overrides", () => {
    expect(
      parseBalanceArgs([
        "--mode",
        "live",
        "--coin",
        "USDC",
        "--product-type",
        "USDC-FUTURES",
      ]),
    ).toEqual({ mode: "live", coin: "USDC", productType: "USDC-FUTURES" });
  });

  it("rejects an invalid mode", () => {
    expect(() => parseBalanceArgs(["--mode", "dry_run"])).toThrow(
      "--mode must be paper or live",
    );
  });

  it("builds the verified get_account_assets query with the required productType", () => {
    const args = buildBalanceArgs(
      { mode: "paper", coin: "USDT", productType: "USDT-FUTURES" },
      ["client.js"],
    );
    expect(args).toEqual([
      "client.js",
      "--paper-trading",
      "account",
      "get_account_assets",
      "--accountType",
      "futures",
      "--productType",
      "USDT-FUTURES",
      "--coin",
      "USDT",
      "--pretty",
    ]);
  });

  it("omits the paper-trading flag in live mode", () => {
    const args = buildBalanceArgs(
      { mode: "live", coin: "USDT", productType: "USDT-FUTURES" },
      [],
    );
    expect(args).not.toContain("--paper-trading");
    expect(args).toContain("--productType");
  });

  it("parses the top-level available balance", () => {
    expect(
      parseAvailable('{"data":[{"marginCoin":"USDT","available":"10000"}]}'),
    ).toBe(10000);
    expect(parseAvailable("no balance here")).toBeNull();
  });

  it("reads the futures available balance via the runner", async () => {
    let childEnv: NodeJS.ProcessEnv | undefined;
    const value = await readFuturesAvailable(
      "paper",
      async (_command, _args, options) => {
        childEnv = options?.env;
        return {
          exitCode: 0,
          stdout: '{"data":[{"available":"2500.5"}]}',
          stderr: "",
        };
      },
      {
        ARENA_BALANCE_COIN: "USDT",
        BITGET_API_BASE_URL: "http://127.0.0.1:9999",
      },
    );
    expect(value).toBe(2500.5);
    expect(childEnv?.ARENA_BALANCE_COIN).toBe("USDT");
    expect(childEnv?.BITGET_API_BASE_URL).toBeUndefined();
  });

  it("returns null when the balance query fails", async () => {
    const value = await readFuturesAvailable(
      "paper",
      async () => ({ exitCode: 1, stdout: "", stderr: "boom" }),
      {},
    );
    expect(value).toBeNull();
  });
});
