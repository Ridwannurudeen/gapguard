import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  attestChain,
  readArenaChain,
  sealArenaRecords,
  verifyAttestation,
  writeArenaChain,
} from "../src/arena-chain";
import {
  acquireAutoTraderLock,
  releaseAutoTraderLock,
} from "../src/autoTraderState";
import type { BrokerConfig, BrokerResult, FuturesOrderIntent } from "../src/liveStockBroker";
import type { RwaMarketReport } from "../src/rwa-market";
import {
  buildRwaRoundTripSpec,
  parseRwaRoundTripArgs,
  runRwaRoundTrip,
} from "../src/rwaRoundTrip";

const market: RwaMarketReport = {
  generatedAt: "2026-06-25T00:00:00.000Z",
  source: {
    baseUrl: "https://api.bitget.com",
    productType: "USDT-FUTURES",
    contracts: "/api/v2/mix/market/contracts",
    tickers: "/api/v2/mix/market/tickers",
  },
  defaultLiveSymbol: "NVDAUSDT",
  backupSymbol: "SOXLUSDT",
  liquidityLeader: "NVDAUSDT",
  selectedLiveSymbol: "NVDAUSDT",
  maxNotionalUSDT: 10,
  rows: [
    {
      symbol: "NVDAUSDT",
      isRwa: "YES",
      symbolStatus: "normal",
      minTradeNum: 0.01,
      minTradeUSDT: 5,
      sizeMultiplier: 0.01,
      maxMarketOrderQty: 100,
      minLever: 1,
      maxLever: 2,
      lastPrice: 200,
      bidPrice: 199.9,
      askPrice: 200.1,
      markPrice: 200,
      indexPrice: 200,
      quoteVolumeUSDT: 1_000_000,
      holdingAmount: 1000,
      fundingRate: 0,
      ts: "2026-06-25T00:00:00.000Z",
      spreadBps: 10,
      suggestedMinSize: 0.03,
      suggestedNotionalUSDT: 6,
      liveReady: true,
      blockers: [],
    },
  ],
};

function fakeResult(intent: FuturesOrderIntent, cfg: BrokerConfig): BrokerResult {
  return {
    status: cfg.mode === "dry_run" ? "dry_run" : "filled",
    plan: {
      mode: cfg.mode,
      order: {
        symbol: intent.symbol,
        productType: "USDT-FUTURES",
        marginMode: "isolated",
        marginCoin: "USDT",
        size: String(intent.size),
        side: intent.side.endsWith("long") ? "buy" : "sell",
        tradeSide: intent.side.startsWith("open") ? "open" : "close",
        clientOid: intent.clientOid ?? "missing",
        orderType: "market",
      },
      notionalUSDT: intent.size * intent.referencePrice,
      command: "bgc",
      args: [],
    },
  };
}

describe("RWA round-trip runbook", () => {
  it("parses a safe dry-run default", () => {
    expect(parseRwaRoundTripArgs([], {})).toMatchObject({
      mode: "dry_run",
      side: "long",
      maxNotionalUSDT: 10,
      confirmLive: false,
      appendChain: false,
    });
  });

  it("sizes from the selected live-ready RWA market row", () => {
    const spec = buildRwaRoundTripSpec(parseRwaRoundTripArgs([], {}), market);

    expect(spec).toMatchObject({
      symbol: "NVDAUSDT",
      size: 0.03,
      referencePrice: 200,
      notionalUSDT: 6,
      openSide: "open_long",
      closeSide: "close_long",
    });
  });

  it("requires an explicit client OID prefix for live idempotency", () => {
    expect(() =>
      buildRwaRoundTripSpec(
        parseRwaRoundTripArgs(["--mode", "live", "--confirm-live"], {}),
        market,
      ),
    ).toThrow("--client-oid-prefix");
  });

  it("builds open and close dry-run legs without touching live balances", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gapguard-rwa-roundtrip-"));
    const seen: FuturesOrderIntent[] = [];
    const result = await runRwaRoundTrip(
      {
        ...parseRwaRoundTripArgs(
          [
            "--client-oid-prefix",
            "roundtrip-test",
            "--out",
            join(dir, "roundtrip.jsonl"),
          ],
          {},
        ),
      },
      {
        market,
        now: () => new Date("2026-06-25T00:00:00.000Z"),
        place: async (intent, cfg) => {
          seen.push(intent);
          return fakeResult(intent, cfg);
        },
        readBalance: async () => {
          throw new Error("dry-run must not read live balance");
        },
      },
    );

    expect(result.mode).toBe("dry_run");
    expect(result.chainAppended).toBe(false);
    expect(seen.map((intent) => intent.side)).toEqual([
      "open_long",
      "close_long",
    ]);
    expect(seen.map((intent) => intent.clientOid)).toEqual([
      "roundtrip-test-open",
      "roundtrip-test-close",
    ]);
  });

  it("appends a filled live round trip through the shared attested primitive", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gapguard-rwa-live-evidence-"));
    const chainPath = join(dir, "arena-chain.jsonl");
    const attestationPath = join(dir, "arena-attestation.json");
    const publicKeyPath = join(dir, "arena-pubkey.pem");
    const privateKeyPath = join(dir, "arena-private.pem");
    const out = join(dir, "roundtrip.jsonl");
    const sharedLockPath = join(dir, "arena-chain.lock");
    const pair = generateKeyPairSync("ed25519");
    const records = sealArenaRecords([
      {
        ts: "2026-06-24T00:00:00.000Z",
        kind: "quorum_decision",
        agentId: "quorum",
        payload: { vote: "long", multiplier: 0.5 },
      },
    ]);
    writeArenaChain(chainPath, records);
    writeFileSync(
      attestationPath,
      `${JSON.stringify(
        attestChain(records, {
          signedAt: "2026-06-24T00:00:00.000Z",
          privateKey: pair.privateKey,
        }),
        null,
        2,
      )}\n`,
    );
    writeFileSync(
      publicKeyPath,
      pair.publicKey.export({ format: "pem", type: "spki" }),
    );
    writeFileSync(
      privateKeyPath,
      pair.privateKey.export({ format: "pem", type: "pkcs8" }),
    );
    const args = parseRwaRoundTripArgs(
      [
        "--mode",
        "live",
        "--confirm-live",
        "--client-oid-prefix",
        "roundtrip-live-test",
        "--append-chain",
        "--out",
        out,
        "--chain",
        chainPath,
        "--attestation",
        attestationPath,
        "--public-key",
        publicKeyPath,
      ],
      {},
    );

    const deps = {
      market,
      now: () => new Date("2026-06-25T00:00:00.000Z"),
      place: async (intent: FuturesOrderIntent, cfg: BrokerConfig) =>
        fakeResult(intent, cfg),
      readBalance: async () => 20,
      env: {
        ARENA_SIGNING_KEY_FILE: privateKeyPath,
        AUTO_TRADE_ARENA_LOCK_PATH: sharedLockPath,
      },
    };
    const held = acquireAutoTraderLock(
      sharedLockPath,
      new Date(),
      600_000,
    );
    if (!held.acquired) throw new Error("expected shared Arena lock");
    await expect(runRwaRoundTrip(args, deps)).rejects.toThrow(
      "auto-trader lock is active",
    );
    expect(releaseAutoTraderLock(held.lock)).toBe(true);

    const result = await runRwaRoundTrip(args, deps);
    const updated = readArenaChain(chainPath);
    const attestation = JSON.parse(readFileSync(attestationPath, "utf8"));

    expect(result.chainAppended).toBe(true);
    expect(updated).toHaveLength(2);
    expect(updated.at(-1)).toMatchObject({
      kind: "broker_order",
      payload: { label: "LIVE_RWA_ROUND_TRIP" },
    });
    expect(
      verifyAttestation(updated, attestation, { publicKey: pair.publicKey }).ok,
    ).toBe(true);
  });
});
