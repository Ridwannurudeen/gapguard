import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildAutoTraderClientOid,
  parseAutoTraderArgs,
  reconcileAutoTraderState,
  runAutoTrader,
  selectAutoTradeCandidate,
} from "../src/autoTrader";
import type {
  AutoTraderExchangeOrder,
  AutoTraderExchangeSnapshot,
} from "../src/autoTraderExchange";
import type { AutoTraderEvidenceRow } from "../src/autoTraderEvidence";
import {
  createAutoTraderState,
  parseAutoTraderConfig,
  readAutoTraderState,
  reservePendingOrder,
  updatePendingOrder,
  writeAutoTraderState,
} from "../src/autoTraderState";
import {
  buildArenaScenarioFromRwaMarket,
  type ArenaScenario,
} from "../src/arenaScenario";
import {
  BrokerPostSubmissionError,
  type BrokerConfig,
  type BrokerResult,
  type FuturesOrderIntent,
} from "../src/liveStockBroker";
import type { RwaMarketReport, RwaMarketRow } from "../src/rwa-market";

const NOW = new Date("2026-07-10T12:00:00.000Z");
const DAY_START = Date.parse("2026-07-10T00:00:00.000Z");

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

interface TestPaths {
  dir: string;
  liveState: string;
  dryRunState: string;
  liveLock: string;
  dryRunLock: string;
  killSwitch: string;
  journal: string;
  arenaChain: string;
  arenaAttestation: string;
  arenaPublicKey: string;
  arenaLock: string;
}

function testPaths(): TestPaths {
  const dir = mkdtempSync(join(tmpdir(), "gapguard-auto-trader-"));
  temporaryDirectories.push(dir);
  return {
    dir,
    liveState: join(dir, "auto-trader-live.json"),
    dryRunState: join(dir, "auto-trader-dry-run.json"),
    liveLock: join(dir, "auto-trader-live.lock"),
    dryRunLock: join(dir, "auto-trader-dry-run.lock"),
    killSwitch: join(dir, "AUTO_TRADE_KILL"),
    journal: join(dir, "auto-trades.jsonl"),
    arenaChain: join(dir, "arena-chain.jsonl"),
    arenaAttestation: join(dir, "arena-attestation.json"),
    arenaPublicKey: join(dir, "arena-pubkey.pem"),
    arenaLock: join(dir, "arena-chain.lock"),
  };
}

function enabledEnv(
  paths: TestPaths,
  overrides: NodeJS.ProcessEnv = {},
): NodeJS.ProcessEnv {
  return {
    AUTO_TRADE_ENABLED: "true",
    AUTO_TRADE_STATE_PATH: paths.liveState,
    AUTO_TRADE_DRY_RUN_STATE_PATH: paths.dryRunState,
    AUTO_TRADE_LOCK_PATH: paths.liveLock,
    AUTO_TRADE_DRY_RUN_LOCK_PATH: paths.dryRunLock,
    AUTO_TRADE_KILL_SWITCH_PATH: paths.killSwitch,
    AUTO_TRADE_JOURNAL_PATH: paths.journal,
    AUTO_TRADE_ARENA_CHAIN_PATH: paths.arenaChain,
    AUTO_TRADE_ARENA_ATTESTATION_PATH: paths.arenaAttestation,
    AUTO_TRADE_ARENA_PUBLIC_KEY_PATH: paths.arenaPublicKey,
    AUTO_TRADE_ARENA_LOCK_PATH: paths.arenaLock,
    AUTO_TRADE_DRY_RUN_EQUITY_USDT: "100",
    AUTO_TRADE_MAX_POSITION_PCT: "0.2",
    AUTO_TRADE_MAX_MARKET_AGE_MS: "300000",
    LIVE_MAX_NOTIONAL_USDT: "20",
    ...overrides,
  };
}

function marketRow(
  symbol: string,
  overrides: Partial<RwaMarketRow> = {},
): RwaMarketRow {
  return {
    isRwa: "YES",
    symbolStatus: "normal",
    minTradeNum: 0.01,
    minTradeUSDT: 5,
    sizeMultiplier: 0.01,
    maxMarketOrderQty: 100,
    minLever: 1,
    maxLever: 2,
    lastPrice: 100,
    bidPrice: 99.9,
    askPrice: 100.1,
    markPrice: 100,
    indexPrice: 105,
    quoteVolumeUSDT: 1_000_000,
    holdingAmount: 1_000,
    fundingRate: 0,
    ts: NOW.toISOString(),
    spreadBps: 20,
    suggestedMinSize: 0.05,
    suggestedNotionalUSDT: 5,
    liveReady: true,
    blockers: [],
    ...overrides,
    symbol,
  };
}

function marketReport(rows: RwaMarketRow[]): RwaMarketReport {
  const selected = rows[0]?.symbol ?? null;
  return {
    generatedAt: NOW.toISOString(),
    source: {
      baseUrl: "https://api.bitget.com",
      productType: "USDT-FUTURES",
      contracts: "/api/v2/mix/market/contracts",
      tickers: "/api/v2/mix/market/tickers",
    },
    defaultLiveSymbol: selected ?? "NVDAUSDT",
    backupSymbol: rows[1]?.symbol ?? null,
    liquidityLeader: selected,
    selectedLiveSymbol: selected,
    maxNotionalUSDT: 20,
    rows,
  };
}

interface ScenarioDecision {
  vote: "long" | "short" | "flat";
  consensusScore: number;
  vetoed: boolean;
  positionMultiplier: number;
  confidence: number;
}

const DEFAULT_DECISION: ScenarioDecision = {
  vote: "long",
  consensusScore: 0.8,
  vetoed: false,
  positionMultiplier: 0.5,
  confidence: 0.8,
};

function scenarioBuilder(
  decisions: Record<string, Partial<ScenarioDecision>> = {},
): typeof buildArenaScenarioFromRwaMarket {
  return (report, symbol, fallbackReferencePrice, liveCap) => {
    const scenario = buildArenaScenarioFromRwaMarket(
      report,
      symbol,
      fallbackReferencePrice,
      liveCap,
      {
        paperTrades: 3,
        backtest: {
          source: "test",
          variant: "gateDriven",
          returnPct: 1,
          sharpeAnnualized: 1,
          totalTrades: 3,
          alphaStatus: "positive",
          note: "deterministic positive fixture",
        },
        rwaFreshness: {
          path: "test",
          status: "fresh",
          generatedAt: report.generatedAt,
          ageMinutes: 0,
          maxAgeMinutes: 5,
        },
      },
    );
    const decision = { ...DEFAULT_DECISION, ...decisions[scenario.symbol] };
    return {
      ...scenario,
      perception: {
        ...scenario.perception,
        dislocation: {
          ...scenario.perception.dislocation,
          confidence: decision.confidence,
        },
      },
      quorumDecision: {
        ...scenario.quorumDecision,
        winningVote: decision.vote,
        consensusScore: decision.consensusScore,
        vetoed: decision.vetoed,
        positionMultiplier: decision.positionMultiplier,
      },
    } satisfies ArenaScenario;
  };
}

function exchangeOrder(
  overrides: Partial<AutoTraderExchangeOrder> = {},
): AutoTraderExchangeOrder {
  return {
    orderId: "order-1",
    clientOid: "ggauto-existing",
    symbol: "NVDAUSDT",
    status: "filled",
    tradeSide: "open",
    createdAt: NOW.getTime(),
    ...overrides,
  };
}

function exchangeSnapshot(
  overrides: Partial<AutoTraderExchangeSnapshot> = {},
): AutoTraderExchangeSnapshot {
  return {
    equityUSDT: 100,
    realizedPnlUSDT: 0,
    pendingOrders: [],
    openPositions: [],
    recentOrders: [],
    captureStartedAt: NOW.toISOString(),
    openActivityDuringCapture: false,
    capturedAt: NOW.toISOString(),
    ...overrides,
  };
}

function brokerResult(
  intent: FuturesOrderIntent,
  config: BrokerConfig,
  status: BrokerResult["status"],
): BrokerResult {
  const orderId = status === "dry_run" ? null : `order-${status}`;
  return {
    status,
    plan: {
      mode: config.mode,
      order: {
        symbol: intent.symbol,
        productType: "USDT-FUTURES",
        marginMode: "isolated",
        marginCoin: "USDT",
        size: String(intent.size),
        side: intent.side === "open_long" ? "buy" : "sell",
        tradeSide: "open",
        clientOid: intent.clientOid ?? "missing-client-oid",
        orderType: "market",
      },
      notionalUSDT: intent.size * intent.referencePrice,
      command: "bgc",
      args: [],
    },
    ...(status === "dry_run"
      ? {}
      : {
          receipt: {
            clientOid: intent.clientOid ?? "missing-client-oid",
            orderId,
            status,
            executedQty: status === "filled" ? intent.size : null,
            avgFillPrice: status === "filled" ? intent.referencePrice : null,
            feeUSDT: null,
            realizedPnlUSDT: null,
            balanceDelta: null,
            transitions: [],
          },
        }),
  };
}

describe("auto-trader arguments and candidate selection", () => {
  it("defaults to dry-run and rejects ambiguous mode arguments", () => {
    expect(parseAutoTraderArgs([])).toEqual({ mode: "dry_run" });
    expect(parseAutoTraderArgs(["--mode", "live"])).toEqual({ mode: "live" });
    expect(
      parseAutoTraderArgs(["--mode", "live", "--rearm-persistent-kill"]),
    ).toEqual({ mode: "live", rearmPersistentKill: true });
    expect(() => parseAutoTraderArgs(["--mode"])).toThrow("requires a value");
    expect(() => parseAutoTraderArgs(["--mode", "paper"])).toThrow(
      "dry_run or live",
    );
    expect(() => parseAutoTraderArgs(["--confirm-live"])).toThrow(
      "unknown argument",
    );
  });

  it("excludes vetoed and flat candidates, then ranks actionable signals by consensus", () => {
    const report = marketReport([
      marketRow("VETOUSDT"),
      marketRow("FLATUSDT"),
      marketRow("LOWUSDT"),
      marketRow("BESTUSDT"),
    ]);
    const selection = selectAutoTradeCandidate({
      report,
      now: NOW,
      equityUSDT: 100,
      maxNotionalUSDT: 20,
      maxPositionPct: 0.2,
      maxMarketAgeMs: 300_000,
      buildScenario: scenarioBuilder({
        VETOUSDT: {
          vote: "long",
          consensusScore: 0.99,
          vetoed: true,
          positionMultiplier: 0,
        },
        FLATUSDT: {
          vote: "flat",
          consensusScore: 0.98,
          positionMultiplier: 0,
        },
        LOWUSDT: { consensusScore: 0.7 },
        BESTUSDT: { vote: "short", consensusScore: 0.9 },
      }),
    });

    expect(selection.candidate).toMatchObject({
      row: { symbol: "BESTUSDT" },
      side: "open_short",
      passport: { grade: "LICENSED" },
    });
  });

  it("uses confidence and then liquidity as deterministic ranking tie-breakers", () => {
    const report = marketReport([
      marketRow("LOWCONFUSDT", { quoteVolumeUSDT: 9_000_000 }),
      marketRow("LOWVOLUMEUSDT", { quoteVolumeUSDT: 1_000_000 }),
      marketRow("HIGHVOLUMEUSDT", { quoteVolumeUSDT: 2_000_000 }),
    ]);
    const selection = selectAutoTradeCandidate({
      report,
      now: NOW,
      equityUSDT: 100,
      maxNotionalUSDT: 20,
      maxPositionPct: 0.2,
      maxMarketAgeMs: 300_000,
      buildScenario: scenarioBuilder({
        LOWCONFUSDT: { consensusScore: 0.8, confidence: 0.6 },
        LOWVOLUMEUSDT: { consensusScore: 0.8, confidence: 0.9 },
        HIGHVOLUMEUSDT: { consensusScore: 0.8, confidence: 0.9 },
      }),
    });

    expect(selection.candidate?.row.symbol).toBe("HIGHVOLUMEUSDT");
  });

  it("requires a complete sub-25bps book and prices entries at the executable quote", () => {
    const report = marketReport([
      marketRow("MISSINGUSDT", { spreadBps: null }),
      marketRow("WIDEUSDT", {
        bidPrice: 99.8,
        askPrice: 100.2,
        spreadBps: 20,
      }),
      marketRow("LONGUSDT", {
        minTradeUSDT: 0,
        bidPrice: 99.9,
        askPrice: 100.1,
        spreadBps: 20,
      }),
      marketRow("SHORTUSDT", {
        minTradeUSDT: 0,
        bidPrice: 199.8,
        askPrice: 200.2,
        spreadBps: 20,
      }),
    ]);
    const selection = selectAutoTradeCandidate({
      report,
      now: NOW,
      equityUSDT: 100,
      maxNotionalUSDT: 20,
      maxPositionPct: 0.2,
      maxMarketAgeMs: 300_000,
      buildScenario: scenarioBuilder({
        MISSINGUSDT: { consensusScore: 1 },
        WIDEUSDT: { consensusScore: 0.99 },
        LONGUSDT: { consensusScore: 0.8 },
        SHORTUSDT: { vote: "short", consensusScore: 0.9 },
      }),
    });

    expect(selection.candidate).toMatchObject({
      row: { symbol: "SHORTUSDT" },
      side: "open_short",
      referencePrice: 199.8,
    });
    expect(selection.candidate?.notionalUSDT).toBeCloseTo(1.998);
  });

  it("abstains when the exchange minimum exceeds 20% equity and never scales below the minimum", () => {
    const report = marketReport([marketRow("NVDAUSDT")]);
    const buildScenario = scenarioBuilder({
      NVDAUSDT: { positionMultiplier: 1 },
    });
    const blocked = selectAutoTradeCandidate({
      report,
      now: NOW,
      equityUSDT: 20,
      maxNotionalUSDT: 20,
      maxPositionPct: 0.2,
      maxMarketAgeMs: 300_000,
      buildScenario,
    });
    const allowed = selectAutoTradeCandidate({
      report,
      now: NOW,
      equityUSDT: 30,
      maxNotionalUSDT: 20,
      maxPositionPct: 0.2,
      maxMarketAgeMs: 300_000,
      buildScenario,
    });

    expect(blocked).toEqual({
      candidate: null,
      reason:
        "no actionable candidate fits the equity risk budget and exchange minimum",
    });
    expect(allowed.candidate).toMatchObject({
      size: 0.05,
      riskBudgetUSDT: 6,
    });
    expect(allowed.candidate?.notionalUSDT).toBeCloseTo(5.005);
  });

  it("builds a deterministic, sanitized autonomous client OID", () => {
    const first = buildAutoTraderClientOid("NVDA/USDT", NOW);
    const second = buildAutoTraderClientOid("NVDA/USDT", NOW);

    expect(first).toBe(second);
    expect(first).toMatch(/^ggauto-[a-z0-9]+-nvdausdt$/);
  });
});

describe("persistent kill-switch re-arm", () => {
  it("reconciles under the live lock and clears only the persistent trip", async () => {
    const paths = testPaths();
    writeAutoTraderState(paths.liveState, {
      ...createAutoTraderState(NOW),
      tradesOpened: 2,
      killSwitchTripped: true,
      killSwitchReason: "operator stop",
    });
    let exchangeReads = 0;
    let boundaryCalls = 0;

    const result = await runAutoTrader(
      { mode: "live", rearmPersistentKill: true },
      {
        env: enabledEnv(paths, { AUTO_TRADE_ENABLED: "false" }),
        now: () => NOW,
        readExchange: async ({ pnlSince, orderHistorySince }) => {
          exchangeReads += 1;
          expect(pnlSince).toBe(DAY_START);
          expect(orderHistorySince).toBe(DAY_START);
          return exchangeSnapshot();
        },
        fetchMarket: async () => {
          boundaryCalls += 1;
          throw new Error("re-arm reached the market boundary");
        },
        place: async () => {
          boundaryCalls += 1;
          throw new Error("re-arm reached the placement boundary");
        },
      },
    );

    expect(result.status).toBe("rearmed");
    expect(exchangeReads).toBe(1);
    expect(boundaryCalls).toBe(0);
    expect(readAutoTraderState(paths.liveState, NOW)).toMatchObject({
      tradesOpened: 2,
      killSwitchTripped: false,
      killSwitchReason: null,
    });
  });

  it("refuses to clear a persistent trip while reconciled loss remains at the cap", async () => {
    const paths = testPaths();
    writeAutoTraderState(paths.liveState, {
      ...createAutoTraderState(NOW),
      killSwitchTripped: true,
      killSwitchReason: "daily realized-trade-PnL cap reached",
    });

    const result = await runAutoTrader(
      { mode: "live", rearmPersistentKill: true },
      {
        env: enabledEnv(paths, { AUTO_TRADE_ENABLED: "false" }),
        now: () => NOW,
        readExchange: async () => exchangeSnapshot({ realizedPnlUSDT: -0.3 }),
      },
    );

    expect(result.status).toBe("blocked");
    expect(result.reason).toContain("realized-trade-PnL cap");
    expect(readAutoTraderState(paths.liveState, NOW).killSwitchTripped).toBe(
      true,
    );
  });

  it("re-checks the touch-file gate immediately before clearing the persistent trip", async () => {
    const paths = testPaths();
    writeAutoTraderState(paths.liveState, {
      ...createAutoTraderState(NOW),
      killSwitchTripped: true,
      killSwitchReason: "operator stop",
    });

    const result = await runAutoTrader(
      { mode: "live", rearmPersistentKill: true },
      {
        env: enabledEnv(paths, { AUTO_TRADE_ENABLED: "false" }),
        now: () => NOW,
        readExchange: async () => {
          writeFileSync(paths.killSwitch, "");
          return exchangeSnapshot();
        },
      },
    );

    expect(result.status).toBe("blocked");
    expect(result.reason).toContain("kill-switch file present");
    expect(readAutoTraderState(paths.liveState, NOW).killSwitchTripped).toBe(
      true,
    );
  });
});

describe("auto-trader gates and dry-run isolation", () => {
  it("short-circuits disabled runs before state, market, exchange, or placement", async () => {
    const paths = testPaths();
    let boundaryCalls = 0;
    const result = await runAutoTrader(
      { mode: "dry_run" },
      {
        env: enabledEnv(paths, { AUTO_TRADE_ENABLED: "false" }),
        now: () => NOW,
        fetchMarket: async () => {
          boundaryCalls += 1;
          throw new Error("disabled run reached market boundary");
        },
        readExchange: async () => {
          boundaryCalls += 1;
          throw new Error("disabled run reached private exchange boundary");
        },
        place: async () => {
          boundaryCalls += 1;
          throw new Error("disabled run reached placement boundary");
        },
      },
    );

    expect(result.status).toBe("disabled");
    expect(boundaryCalls).toBe(0);
    expect(existsSync(paths.liveState)).toBe(false);
    expect(existsSync(paths.dryRunState)).toBe(false);
    expect(existsSync(paths.dryRunLock)).toBe(false);
  });

  it("gives a touch-file kill switch precedence and exits before every external boundary", async () => {
    const paths = testPaths();
    writeFileSync(paths.killSwitch, "");
    let boundaryCalls = 0;
    const result = await runAutoTrader(
      { mode: "live" },
      {
        env: enabledEnv(paths, {
          AUTO_TRADE_ENABLED: "false",
          AUTO_TRADE_MAX_TRADES_PER_DAY: "not-a-number",
        }),
        now: () => NOW,
        fetchMarket: async () => {
          boundaryCalls += 1;
          throw new Error("killed run reached market boundary");
        },
        readExchange: async () => {
          boundaryCalls += 1;
          throw new Error("killed run reached private exchange boundary");
        },
        place: async () => {
          boundaryCalls += 1;
          throw new Error("killed run reached placement boundary");
        },
      },
    );

    expect(result.status).toBe("blocked");
    expect(result.reason).toContain("kill-switch file present");
    expect(boundaryCalls).toBe(0);
    expect(existsSync(paths.liveState)).toBe(false);
    expect(existsSync(paths.liveLock)).toBe(false);
  });

  it("fails closed when kill-switch absence cannot be verified", async () => {
    const paths = testPaths();
    let boundaryCalls = 0;

    await expect(
      runAutoTrader(
        { mode: "live" },
        {
          env: enabledEnv(paths),
          now: () => NOW,
          killSwitchPresent: () => {
            throw new Error("kill-switch probe I/O error");
          },
          fetchMarket: async () => {
            boundaryCalls += 1;
            throw new Error("probe failure reached market boundary");
          },
          readExchange: async () => {
            boundaryCalls += 1;
            throw new Error("probe failure reached exchange boundary");
          },
          place: async () => {
            boundaryCalls += 1;
            throw new Error("probe failure reached placement boundary");
          },
        },
      ),
    ).rejects.toThrow("kill-switch probe I/O error");

    expect(boundaryCalls).toBe(0);
    expect(existsSync(paths.liveState)).toBe(false);
    expect(existsSync(paths.liveLock)).toBe(false);
  });

  it("runs end to end in dry-run without private reads or live-state mutation", async () => {
    const paths = testPaths();
    const evidence: AutoTraderEvidenceRow[] = [];
    const intents: FuturesOrderIntent[] = [];
    let privateReads = 0;
    const result = await runAutoTrader(
      { mode: "dry_run" },
      {
        env: enabledEnv(paths),
        now: () => NOW,
        fetchMarket: async () => marketReport([marketRow("NVDAUSDT")]),
        buildScenario: scenarioBuilder(),
        readExchange: async () => {
          privateReads += 1;
          throw new Error("dry-run attempted a private exchange read");
        },
        place: async (intent, config) => {
          intents.push(intent);
          expect(config.mode).toBe("dry_run");
          expect(config.confirmLive).toBe(false);
          return brokerResult(intent, config, "dry_run");
        },
        recordEvidence: (row) => {
          evidence.push(row);
        },
      },
    );

    expect(result).toMatchObject({
      mode: "dry_run",
      status: "dry_run",
      symbol: "NVDAUSDT",
    });
    expect(privateReads).toBe(0);
    expect(intents).toHaveLength(1);
    expect(intents[0]).toMatchObject({
      orderType: "limit",
      limitPrice: 100.1,
      force: "fok",
    });
    expect(intents[0].stopLossPrice).toBeCloseTo(100.1 * 0.985);
    expect(intents[0].takeProfitPrice).toBeCloseTo(100.1 * 1.015);
    expect(evidence).toHaveLength(1);
    expect(evidence[0]).toMatchObject({
      trigger: "auto",
      mode: "dry_run",
      status: "dry_run",
    });
    expect(existsSync(paths.liveState)).toBe(false);
    expect(existsSync(paths.dryRunState)).toBe(true);
    expect(existsSync(paths.dryRunLock)).toBe(false);
  });
});

describe("live pre-placement rechecks", () => {
  it("preflights evidence before taking the final exchange snapshot", async () => {
    const paths = testPaths();
    const events: string[] = [];
    let exchangeReads = 0;

    const result = await runAutoTrader(
      { mode: "live" },
      {
        env: enabledEnv(paths),
        now: () => NOW,
        fetchMarket: async () => marketReport([marketRow("NVDAUSDT")]),
        buildScenario: scenarioBuilder(),
        readExchange: async () => {
          exchangeReads += 1;
          events.push(`exchange-${exchangeReads}`);
          return exchangeSnapshot();
        },
        preflightEvidence: () => {
          events.push("evidence-preflight");
        },
        place: async (intent, config) => {
          events.push("place");
          return brokerResult(intent, config, "filled");
        },
        recordEvidence: () => {
          events.push("evidence-record");
        },
      },
    );

    expect(result.status).toBe("filled");
    expect(events).toEqual([
      "exchange-1",
      "evidence-preflight",
      "exchange-2",
      "place",
      "evidence-record",
    ]);
  });

  it("fails closed if the run crosses a UTC day boundary", async () => {
    const paths = testPaths();
    const beforeMidnight = new Date("2026-07-10T23:59:59.900Z");
    const afterMidnight = new Date("2026-07-11T00:00:00.100Z");
    const report = {
      ...marketReport([
        marketRow("NVDAUSDT", { ts: beforeMidnight.toISOString() }),
      ]),
      generatedAt: beforeMidnight.toISOString(),
    };
    let clockReads = 0;
    let exchangeReads = 0;
    let placements = 0;

    const result = await runAutoTrader(
      { mode: "live" },
      {
        env: enabledEnv(paths),
        now: () => (clockReads++ === 0 ? beforeMidnight : afterMidnight),
        fetchMarket: async () => report,
        buildScenario: scenarioBuilder(),
        readExchange: async () => {
          exchangeReads += 1;
          return exchangeSnapshot();
        },
        place: async (intent, config) => {
          placements += 1;
          return brokerResult(intent, config, "filled");
        },
        preflightEvidence: () => undefined,
        recordEvidence: () => undefined,
      },
    );

    expect(result.status).toBe("blocked");
    expect(result.reason).toContain("UTC day changed");
    expect(exchangeReads).toBe(1);
    expect(placements).toBe(0);
  });

  it("fails closed if the final exchange snapshot crosses a UTC day boundary", async () => {
    const paths = testPaths();
    const beforeMidnight = new Date("2026-07-10T23:59:59.900Z");
    const afterMidnight = new Date("2026-07-11T00:00:00.100Z");
    const report = {
      ...marketReport([
        marketRow("NVDAUSDT", { ts: beforeMidnight.toISOString() }),
      ]),
      generatedAt: beforeMidnight.toISOString(),
    };
    const clockValues = [beforeMidnight, beforeMidnight, afterMidnight];
    let clockReads = 0;
    let placements = 0;

    const result = await runAutoTrader(
      { mode: "live" },
      {
        env: enabledEnv(paths),
        now: () => clockValues[clockReads++] ?? afterMidnight,
        fetchMarket: async () => report,
        buildScenario: scenarioBuilder(),
        readExchange: async () => exchangeSnapshot(),
        place: async (intent, config) => {
          placements += 1;
          return brokerResult(intent, config, "filled");
        },
        preflightEvidence: () => undefined,
        recordEvidence: () => undefined,
      },
    );

    expect(result.status).toBe("blocked");
    expect(result.reason).toContain("UTC day changed");
    expect(clockReads).toBe(3);
    expect(placements).toBe(0);
  });

  it.each([
    ["reservation", 4],
    ["placement", 5],
  ] as const)(
    "fails closed if UTC midnight passes immediately before %s",
    async (_boundary, boundaryRead) => {
      const paths = testPaths();
      const beforeMidnight = new Date("2026-07-10T23:59:59.900Z");
      const afterMidnight = new Date("2026-07-11T00:00:00.100Z");
      const report = {
        ...marketReport([
          marketRow("NVDAUSDT", { ts: beforeMidnight.toISOString() }),
        ]),
        generatedAt: beforeMidnight.toISOString(),
      };
      const clockValues = [
        ...Array.from({ length: boundaryRead - 1 }, () => beforeMidnight),
        afterMidnight,
      ];
      let clockReads = 0;
      let placements = 0;

      const result = await runAutoTrader(
        { mode: "live" },
        {
          env: enabledEnv(paths),
          now: () => clockValues[clockReads++] ?? afterMidnight,
          fetchMarket: async () => report,
          buildScenario: scenarioBuilder(),
          readExchange: async () => exchangeSnapshot(),
          place: async (intent, config) => {
            placements += 1;
            return brokerResult(intent, config, "filled");
          },
          preflightEvidence: () => undefined,
          recordEvidence: () => undefined,
        },
      );

      expect(result.status).toBe("blocked");
      expect(result.reason).toContain("UTC day changed");
      expect(clockReads).toBe(boundaryRead);
      expect(placements).toBe(0);
      expect(
        readAutoTraderState(paths.liveState, beforeMidnight).pendingOrder,
      ).toBe(null);
    },
  );

  it("re-checks the touch-file kill switch after market selection", async () => {
    const paths = testPaths();
    let exchangeReads = 0;
    let placements = 0;
    const result = await runAutoTrader(
      { mode: "live" },
      {
        env: enabledEnv(paths),
        now: () => NOW,
        fetchMarket: async () => {
          writeFileSync(paths.killSwitch, "");
          return marketReport([marketRow("NVDAUSDT")]);
        },
        buildScenario: scenarioBuilder(),
        readExchange: async () => {
          exchangeReads += 1;
          return exchangeSnapshot();
        },
        place: async (intent, config) => {
          placements += 1;
          return brokerResult(intent, config, "filled");
        },
        preflightEvidence: () => undefined,
        recordEvidence: () => undefined,
      },
    );

    expect(result.status).toBe("blocked");
    expect(result.reason).toContain("kill-switch file present");
    expect(exchangeReads).toBe(1);
    expect(placements).toBe(0);
  });

  it("re-reads daily state before placement", async () => {
    const paths = testPaths();
    let placements = 0;
    const result = await runAutoTrader(
      { mode: "live" },
      {
        env: enabledEnv(paths),
        now: () => NOW,
        fetchMarket: async () => {
          const state = readAutoTraderState(paths.liveState, NOW);
          writeAutoTraderState(paths.liveState, {
            ...state,
            tradesOpened: 3,
          });
          return marketReport([marketRow("NVDAUSDT")]);
        },
        buildScenario: scenarioBuilder(),
        readExchange: async () => exchangeSnapshot(),
        place: async (intent, config) => {
          placements += 1;
          return brokerResult(intent, config, "filled");
        },
        preflightEvidence: () => undefined,
        recordEvidence: () => undefined,
      },
    );

    expect(result.status).toBe("blocked");
    expect(result.reason).toContain("trade-count cap");
    expect(placements).toBe(0);
  });

  it.each<{
    name: string;
    second: AutoTraderExchangeSnapshot;
  }>([
    {
      name: "a pending order",
      second: exchangeSnapshot({
        pendingOrders: [
          exchangeOrder({ status: "live", clientOid: "external-order" }),
        ],
      }),
    },
    {
      name: "an open position",
      second: exchangeSnapshot({
        openPositions: [
          {
            marginCoin: "USDT",
            symbol: "NVDAUSDT",
            holdSide: "long",
            total: 0.05,
            openDelegateSize: 0,
          },
        ],
      }),
    },
    {
      name: "opening activity during capture",
      second: exchangeSnapshot({ openActivityDuringCapture: true }),
    },
    {
      name: "the realized-trade-PnL loss cap",
      second: exchangeSnapshot({ realizedPnlUSDT: -0.3 }),
    },
  ])(
    "blocks when the second exchange snapshot contains $name",
    async ({ second }) => {
      const paths = testPaths();
      let exchangeReads = 0;
      let placements = 0;
      const result = await runAutoTrader(
        { mode: "live" },
        {
          env: enabledEnv(paths),
          now: () => NOW,
          fetchMarket: async () => marketReport([marketRow("NVDAUSDT")]),
          buildScenario: scenarioBuilder(),
          readExchange: async ({ pnlSince, orderHistorySince }) => {
            expect(pnlSince).toBe(DAY_START);
            expect(orderHistorySince).toBe(DAY_START);
            exchangeReads += 1;
            return exchangeReads === 1 ? exchangeSnapshot() : second;
          },
          place: async (intent, config) => {
            placements += 1;
            return brokerResult(intent, config, "filled");
          },
          preflightEvidence: () => undefined,
          recordEvidence: () => undefined,
        },
      );

      expect(result.status).toBe("blocked");
      expect(exchangeReads).toBe(2);
      expect(placements).toBe(0);
    },
  );
});

describe("exchange reconciliation and duplicate prevention", () => {
  it("reconstructs the daily count from distinct filled autonomous opens", () => {
    const state = createAutoTraderState(NOW);
    const snapshot = exchangeSnapshot({
      recentOrders: [
        exchangeOrder({ orderId: "1", clientOid: "ggauto-first" }),
        exchangeOrder({ orderId: "1-duplicate", clientOid: "ggauto-first" }),
        exchangeOrder({ orderId: "2", clientOid: "ggauto-second" }),
        exchangeOrder({
          orderId: "2-one-way-buy",
          clientOid: "ggauto-one-way-buy",
          tradeSide: "buy_single",
        }),
        exchangeOrder({
          orderId: "2-one-way-sell",
          clientOid: "ggauto-one-way-sell",
          tradeSide: "sell_single",
        }),
        exchangeOrder({ orderId: "3", clientOid: "manual-order" }),
        exchangeOrder({
          orderId: "4",
          clientOid: "ggauto-close",
          tradeSide: "close",
        }),
        exchangeOrder({
          orderId: "5",
          clientOid: "ggauto-cancelled",
          status: "cancelled",
        }),
        exchangeOrder({
          orderId: "6",
          clientOid: "ggauto-yesterday",
          createdAt: DAY_START - 1,
        }),
      ],
    });

    const reconciled = reconcileAutoTraderState(
      state,
      snapshot,
      parseAutoTraderConfig({ AUTO_TRADE_ENABLED: "true" }),
    );

    expect(reconciled.tradesOpened).toBe(4);
  });

  it.each(["buy_single", "sell_single"] as const)(
    "reconciles a filled one-way %s reservation as an opening trade",
    (tradeSide) => {
      const clientOid = `ggauto-${tradeSide}`;
      const reserved = reservePendingOrder(createAutoTraderState(NOW), {
        clientOid,
        symbol: "NVDAUSDT",
        reservedAt: NOW.toISOString(),
      });
      const reconciled = reconcileAutoTraderState(
        reserved,
        exchangeSnapshot({
          recentOrders: [
            exchangeOrder({
              orderId: `order-${tradeSide}`,
              clientOid,
              tradeSide,
            }),
          ],
        }),
        parseAutoTraderConfig({ AUTO_TRADE_ENABLED: "true" }),
      );

      expect(reconciled).toMatchObject({
        tradesOpened: 1,
        pendingOrder: {
          clientOid,
          orderId: `order-${tradeSide}`,
          status: "filled",
        },
      });
    },
  );

  it("keeps a reconciled fill durable until its evidence is acknowledged", () => {
    const reserved = reservePendingOrder(createAutoTraderState(NOW), {
      clientOid: "ggauto-filled",
      symbol: "NVDAUSDT",
      reservedAt: NOW.toISOString(),
    });
    const snapshot = exchangeSnapshot({
      recentOrders: [
        exchangeOrder({
          orderId: "filled-order",
          clientOid: "ggauto-filled",
          status: "filled",
        }),
      ],
    });
    const config = parseAutoTraderConfig({ AUTO_TRADE_ENABLED: "true" });

    const first = reconcileAutoTraderState(reserved, snapshot, config);
    const second = reconcileAutoTraderState(first, snapshot, config);

    expect(first.pendingOrder).toMatchObject({
      clientOid: "ggauto-filled",
      orderId: "filled-order",
      status: "filled",
    });
    expect(first.tradesOpened).toBe(1);
    expect(second).toEqual(first);
  });

  it("records a terminal reconciliation before clearing its reservation", async () => {
    const paths = testPaths();
    const clientOid = "ggauto-reconciled";
    writeAutoTraderState(
      paths.liveState,
      reservePendingOrder(createAutoTraderState(NOW), {
        clientOid,
        symbol: "NVDAUSDT",
        reservedAt: NOW.toISOString(),
      }),
    );
    const evidence: AutoTraderEvidenceRow[] = [];
    let marketReads = 0;

    const result = await runAutoTrader(
      { mode: "live" },
      {
        env: enabledEnv(paths, { AUTO_TRADE_MAX_TRADES_PER_DAY: "1" }),
        now: () => NOW,
        readExchange: async () =>
          exchangeSnapshot({
            recentOrders: [
              exchangeOrder({
                orderId: "filled-order",
                clientOid,
                status: "filled",
              }),
            ],
          }),
        fetchMarket: async () => {
          marketReads += 1;
          throw new Error("reconciliation crossed the market boundary");
        },
        recordEvidence: (row) => {
          const persisted = readAutoTraderState(paths.liveState, NOW);
          expect(persisted.pendingOrder).toMatchObject({
            clientOid,
            status: "filled",
          });
          evidence.push(row);
        },
      },
    );

    expect(result.status).toBe("blocked");
    expect(result.reason).toContain("trade-count cap");
    expect(marketReads).toBe(0);
    expect(evidence).toHaveLength(1);
    expect(evidence[0]).toMatchObject({
      trigger: "auto",
      mode: "live",
      status: "filled",
      reconciliation: "exchange_history",
      clientOid,
      orderId: "filled-order",
    });
    expect(readAutoTraderState(paths.liveState, NOW)).toMatchObject({
      tradesOpened: 1,
      pendingOrder: null,
    });
  });

  it("keeps exchange-visible submissions reserved and ambiguous timeouts blocked", () => {
    const reserved = reservePendingOrder(createAutoTraderState(NOW), {
      clientOid: "ggauto-ambiguous",
      symbol: "NVDAUSDT",
      reservedAt: NOW.toISOString(),
    });
    const config = parseAutoTraderConfig({ AUTO_TRADE_ENABLED: "true" });
    const submitted = reconcileAutoTraderState(
      reserved,
      exchangeSnapshot({
        pendingOrders: [
          exchangeOrder({
            orderId: "pending-order",
            clientOid: "ggauto-ambiguous",
            status: "live",
          }),
        ],
      }),
      config,
    );
    const timedOut = updatePendingOrder(reserved, "ggauto-ambiguous", {
      status: "timeout",
    });
    const stillAmbiguous = reconcileAutoTraderState(
      timedOut,
      exchangeSnapshot(),
      config,
    );

    expect(submitted.pendingOrder).toMatchObject({
      clientOid: "ggauto-ambiguous",
      status: "submitted",
      orderId: "pending-order",
    });
    expect(
      reconcileAutoTraderState(
        submitted,
        exchangeSnapshot({
          pendingOrders: [
            exchangeOrder({
              orderId: "pending-order",
              clientOid: "ggauto-ambiguous",
              status: "live",
            }),
          ],
        }),
        config,
      ),
    ).toEqual(submitted);
    expect(stillAmbiguous.pendingOrder).toEqual(timedOut.pendingOrder);
  });

  it.each<BrokerResult["status"]>(["submitted", "timeout"])(
    "persists a %s outcome and blocks the next run from duplicating it",
    async (status) => {
      const paths = testPaths();
      const env = enabledEnv(paths);
      let exchangeReads = 0;
      let marketReads = 0;
      let placements = 0;
      const common = {
        env,
        now: () => NOW,
        buildScenario: scenarioBuilder(),
        readExchange: async () => {
          exchangeReads += 1;
          return exchangeSnapshot();
        },
        place: async (intent: FuturesOrderIntent, config: BrokerConfig) => {
          placements += 1;
          const reserved = readAutoTraderState(paths.liveState, NOW);
          expect(reserved.pendingOrder).toMatchObject({
            clientOid: intent.clientOid,
            status: "reserved",
          });
          return brokerResult(intent, config, status);
        },
        preflightEvidence: () => undefined,
        recordEvidence: () => undefined,
      };
      const first = await runAutoTrader(
        { mode: "live" },
        {
          ...common,
          fetchMarket: async () => {
            marketReads += 1;
            return marketReport([marketRow("NVDAUSDT")]);
          },
        },
      );
      const pending = readAutoTraderState(paths.liveState, NOW).pendingOrder;
      const second = await runAutoTrader(
        { mode: "live" },
        {
          ...common,
          fetchMarket: async () => {
            marketReads += 1;
            throw new Error("ambiguous order allowed a duplicate market scan");
          },
        },
      );

      expect(first.status).toBe(status);
      expect(first.clientOid).toBe(buildAutoTraderClientOid("NVDAUSDT", NOW));
      expect(pending).toMatchObject({
        clientOid: first.clientOid,
        status,
        orderId: `order-${status}`,
      });
      expect(second.status).toBe("blocked");
      expect(second.reason).toContain("exchange reconciliation required");
      expect(placements).toBe(1);
      expect(marketReads).toBe(1);
      expect(exchangeReads).toBe(3);
    },
  );

  it("keeps a cancelled result without an orderId ambiguous", async () => {
    const paths = testPaths();
    const evidence: AutoTraderEvidenceRow[] = [];
    let marketReads = 0;
    const common = {
      env: enabledEnv(paths),
      now: () => NOW,
      buildScenario: scenarioBuilder(),
      readExchange: async () => exchangeSnapshot(),
      preflightEvidence: () => undefined,
      recordEvidence: (row: AutoTraderEvidenceRow) => {
        evidence.push(row);
      },
    };

    const first = await runAutoTrader(
      { mode: "live" },
      {
        ...common,
        fetchMarket: async () => {
          marketReads += 1;
          return marketReport([marketRow("NVDAUSDT")]);
        },
        place: async (intent, config) => {
          const cancelled = brokerResult(intent, config, "cancelled");
          return {
            ...cancelled,
            receipt: { ...cancelled.receipt!, orderId: null },
          };
        },
      },
    );
    const state = readAutoTraderState(paths.liveState, NOW);
    const second = await runAutoTrader(
      { mode: "live" },
      {
        ...common,
        fetchMarket: async () => {
          marketReads += 1;
          throw new Error("ambiguous cancellation allowed a new market scan");
        },
      },
    );

    expect(first.status).toBe("cancelled");
    expect(evidence).toHaveLength(1);
    expect(evidence[0]).toMatchObject({
      status: "cancelled",
      orderId: null,
    });
    expect(state.pendingOrder).toMatchObject({ status: "timeout" });
    expect(state.pendingOrder).not.toHaveProperty("orderId");
    expect(state.pendingOrder).not.toHaveProperty("evidence");
    expect(second.status).toBe("blocked");
    expect(second.reason).toContain("exchange reconciliation required");
    expect(marketReads).toBe(1);
  });

  it("stages a filled outcome before append and replays it before re-arm", async () => {
    const paths = testPaths();
    const attempts: AutoTraderEvidenceRow[] = [];
    const recordEvidence = (row: AutoTraderEvidenceRow): void => {
      attempts.push(row);
      if (attempts.length === 1) {
        throw new Error("attestation disk unavailable");
      }
    };

    await expect(
      runAutoTrader(
        { mode: "live" },
        {
          env: enabledEnv(paths),
          now: () => NOW,
          fetchMarket: async () => marketReport([marketRow("NVDAUSDT")]),
          buildScenario: scenarioBuilder(),
          readExchange: async () => exchangeSnapshot(),
          place: async (intent, config) =>
            brokerResult(intent, config, "filled"),
          preflightEvidence: () => undefined,
          recordEvidence,
        },
      ),
    ).rejects.toThrow("attestation disk unavailable");

    expect(readAutoTraderState(paths.liveState, NOW)).toMatchObject({
      tradesOpened: 1,
      pendingOrder: {
        status: "filled",
        orderId: "order-filled",
        evidence: {
          status: "filled",
          eventId: expect.stringMatching(/^ggauto-outcome-/),
        },
      },
      killSwitchTripped: true,
      killSwitchReason: expect.stringContaining("evidence"),
    });

    const rearmed = await runAutoTrader(
      { mode: "live", rearmPersistentKill: true },
      {
        env: enabledEnv(paths),
        now: () => NOW,
        readExchange: async () => exchangeSnapshot(),
        recordEvidence,
      },
    );

    expect(rearmed.status).toBe("rearmed");
    expect(attempts).toHaveLength(2);
    expect(attempts[1]).toEqual(attempts[0]);
    expect(readAutoTraderState(paths.liveState, NOW)).toMatchObject({
      tradesOpened: 1,
      pendingOrder: null,
      killSwitchTripped: false,
      killSwitchReason: null,
    });
  });

  it("persists the ambiguous reservation and trips the kill switch when order-error evidence also fails", async () => {
    const paths = testPaths();

    await expect(
      runAutoTrader(
        { mode: "live" },
        {
          env: enabledEnv(paths),
          now: () => NOW,
          fetchMarket: async () => marketReport([marketRow("NVDAUSDT")]),
          buildScenario: scenarioBuilder(),
          readExchange: async () => exchangeSnapshot(),
          place: async () => {
            throw new Error("broker result unknown");
          },
          preflightEvidence: () => undefined,
          recordEvidence: () => {
            throw new Error("attestation disk unavailable");
          },
        },
      ),
    ).rejects.toThrow("attestation disk unavailable");

    expect(readAutoTraderState(paths.liveState, NOW)).toMatchObject({
      tradesOpened: 0,
      pendingOrder: {
        status: "timeout",
        evidence: {
          status: "error",
          eventId: expect.stringMatching(/^ggauto-outcome-/),
        },
      },
      killSwitchTripped: true,
      killSwitchReason: expect.stringContaining("evidence"),
    });
  });

  it("retains and evidences the broker receipt when post-submit leverage verification fails", async () => {
    const paths = testPaths();
    const evidence: AutoTraderEvidenceRow[] = [];

    await expect(
      runAutoTrader(
        { mode: "live" },
        {
          env: enabledEnv(paths),
          now: () => NOW,
          fetchMarket: async () => marketReport([marketRow("NVDAUSDT")]),
          buildScenario: scenarioBuilder(),
          readExchange: async () => exchangeSnapshot(),
          place: async (intent, config) => {
            const knownResult = brokerResult(intent, config, "filled");
            throw new BrokerPostSubmissionError(
              "post-submission leverage verification failed",
              knownResult,
            );
          },
          preflightEvidence: () => undefined,
          recordEvidence: (row) => {
            evidence.push(row);
          },
        },
      ),
    ).rejects.toThrow("post-submission leverage verification failed");

    expect(evidence).toHaveLength(1);
    expect(evidence[0]).toMatchObject({
      status: "error",
      orderId: "order-filled",
      result: {
        status: "filled",
        receipt: { orderId: "order-filled", status: "filled" },
      },
    });
    expect(readAutoTraderState(paths.liveState, NOW)).toMatchObject({
      pendingOrder: {
        status: "timeout",
        orderId: "order-filled",
      },
      killSwitchTripped: true,
      killSwitchReason: expect.stringContaining("broker safety verification"),
    });
  });
});
