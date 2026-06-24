import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildOperatorConfig,
  handleOperatorOrder,
  parseOrderRequest,
  startOperatorConsole,
  type OperatorOrderRequest,
} from "../src/operatorConsole";
import type {
  BrokerResult,
  FuturesOrderIntent,
  BrokerConfig,
} from "../src/liveStockBroker";

const validReq: OperatorOrderRequest = {
  mode: "dry_run",
  symbol: "NVDAUSDT",
  side: "open_long",
  size: 0.03,
  referencePrice: 209.62,
  confirmLive: false,
  maxNotionalUSDT: 20,
};

function fakeResult(
  intent: FuturesOrderIntent,
  cfg: BrokerConfig,
): BrokerResult {
  return {
    status: "dry_run",
    plan: {
      mode: cfg.mode,
      order: {
        symbol: intent.symbol,
        productType: "USDT-FUTURES",
        marginMode: "isolated",
        marginCoin: "USDT",
        size: String(intent.size),
        side: "buy",
        tradeSide: "open",
        clientOid: "test-oid",
        orderType: "market",
      },
      notionalUSDT: intent.size * intent.referencePrice,
      command: "bgc",
      args: [],
    },
  };
}

function withFreshRwaMarket<T>(run: () => T): T {
  const dir = mkdtempSync(join(tmpdir(), "gapguard-rwa-"));
  const path = join(dir, "rwa-market.json");
  writeFileSync(
    path,
    `${JSON.stringify({
      generatedAt: new Date().toISOString(),
      defaultLiveSymbol: "NVDAUSDT",
      selectedLiveSymbol: "NVDAUSDT",
      liquidityLeader: "NVDAUSDT",
      maxNotionalUSDT: 20,
      rows: [
        {
          symbol: "NVDAUSDT",
          isRwa: "YES",
          symbolStatus: "normal",
          lastPrice: 209.62,
          markPrice: 209.62,
          indexPrice: 209.62,
          spreadBps: 0.5,
          fundingRate: 0,
          quoteVolumeUSDT: 1_000_000,
          liveReady: true,
          blockers: [],
        },
      ],
    })}\n`,
  );
  const prior = process.env.ARENA_RWA_MARKET_PATH;
  process.env.ARENA_RWA_MARKET_PATH = path;
  try {
    return run();
  } finally {
    if (prior === undefined) {
      delete process.env.ARENA_RWA_MARKET_PATH;
    } else {
      process.env.ARENA_RWA_MARKET_PATH = prior;
    }
  }
}

describe("operator console", () => {
  it("parses a valid order request and defaults confirmLive to false", () => {
    const parsed = parseOrderRequest({ ...validReq, confirmLive: undefined });
    expect(parsed.confirmLive).toBe(false);
    expect(parsed.symbol).toBe("NVDAUSDT");
  });

  it("rejects bad mode / side / size", () => {
    expect(() => parseOrderRequest({ ...validReq, mode: "yolo" })).toThrow();
    expect(() =>
      parseOrderRequest({ ...validReq, side: "sideways" }),
    ).toThrow();
    expect(() => parseOrderRequest({ ...validReq, size: 0 })).toThrow();
  });

  it("builds an isolated/1x config with a passport and plumbs confirmLive", () => {
    const { intent, cfg } = withFreshRwaMarket(() =>
      buildOperatorConfig(
        { ...validReq, mode: "live", confirmLive: true },
        {},
      ),
    );
    expect(intent).toMatchObject({ symbol: "NVDAUSDT", side: "open_long" });
    expect(cfg.marginMode).toBe("isolated");
    expect(cfg.leverage).toBe(1);
    expect(cfg.confirmLive).toBe(true);
    expect(cfg.passport.grade).toBe("LICENSED");
  });

  it("passes the built intent/cfg to the broker and returns its result", async () => {
    let seen: { intent: FuturesOrderIntent; cfg: BrokerConfig } | null = null;
    const result = await handleOperatorOrder(
      validReq,
      {},
      async (intent, cfg) => {
        seen = { intent, cfg };
        return fakeResult(intent, cfg);
      },
    );
    expect(result.status).toBe("dry_run");
    expect(seen!.cfg.mode).toBe("dry_run");
    expect(seen!.intent.size).toBe(0.03);
  });

  it("rejects requests without the operator token (401)", async () => {
    const server = startOperatorConsole({
      token: "secret-token-123",
      port: 0,
      place: async (i, c) => fakeResult(i, c),
    });
    await new Promise((r) => server.on("listening", r));
    const { port } = server.address() as AddressInfo;
    try {
      const noToken = await fetch(`http://127.0.0.1:${port}/api/order`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(validReq),
      });
      expect(noToken.status).toBe(401);

      const withToken = await fetch(`http://127.0.0.1:${port}/api/order`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-operator-token": "secret-token-123",
        },
        body: JSON.stringify(validReq),
      });
      expect(withToken.status).toBe(200);
      const body = await withToken.json();
      expect(body.status).toBe("dry_run");
    } finally {
      server.close();
    }
  });
});
