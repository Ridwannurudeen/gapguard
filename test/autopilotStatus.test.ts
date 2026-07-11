import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  AUTOPILOT_STATUS_HISTORY_LIMIT,
  buildAutopilotStatus,
  parseAutopilotStatusReport,
  publishAutopilotStatus,
  runAutoTraderWithStatus,
  writeAutopilotStatus,
  type AutopilotRun,
  type AutopilotStatusReport,
  type BuildAutopilotStatusOptions,
} from "../src/autopilotStatus";
import type { AutoTraderDailyState } from "../src/autoTraderState";

const NOW = new Date("2026-07-11T12:30:00.000Z");
const tempDirs: string[] = [];

interface TestPaths {
  dir: string;
  liveState: string;
  dryState: string;
  kill: string;
  status: string;
}

function testPaths(): TestPaths {
  const dir = mkdtempSync(join(tmpdir(), "gapguard-autopilot-status-"));
  tempDirs.push(dir);
  return {
    dir,
    liveState: join(dir, "auto-trader-daily.json"),
    dryState: join(dir, "auto-trader-dry-run.json"),
    kill: join(dir, "AUTO_TRADE_KILL"),
    status: join(dir, "autopilot-status.json"),
  };
}

function statusEnv(
  paths: TestPaths,
  overrides: NodeJS.ProcessEnv = {},
): NodeJS.ProcessEnv {
  return {
    AUTO_TRADE_ENABLED: "true",
    AUTO_TRADE_MAX_TRADES_PER_DAY: "3",
    AUTO_TRADE_MAX_DAILY_LOSS_USDT: "0.30",
    AUTO_TRADE_MAX_POSITION_PCT: "0.20",
    AUTO_TRADE_STATE_PATH: paths.liveState,
    AUTO_TRADE_DRY_RUN_STATE_PATH: paths.dryState,
    AUTO_TRADE_KILL_SWITCH_PATH: paths.kill,
    AUTO_TRADE_LOCK_PATH: join(paths.dir, "auto-trader.lock"),
    AUTO_TRADE_STATUS_PATH: paths.status,
    AUTO_TRADE_CADENCE_MINUTES: "30",
    ...overrides,
  };
}

function dailyState(
  overrides: Partial<AutoTraderDailyState> = {},
): AutoTraderDailyState {
  return {
    date: "2026-07-11",
    tradesOpened: 0,
    realizedPnlUSDT: 0,
    killSwitchTripped: false,
    killSwitchReason: null,
    pendingOrder: null,
    ...overrides,
  };
}

function writeState(path: string, state = dailyState()): void {
  writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`);
}

function run(
  index: number,
  outcome: AutopilotRun["outcome"] = "no_signal",
): AutopilotRun {
  return {
    startedAt: new Date(NOW.getTime() + index * 60_000).toISOString(),
    completedAt: new Date(NOW.getTime() + index * 60_000 + 1_000).toISOString(),
    outcome,
  };
}

function reportWithRuns(
  base: AutopilotStatusReport,
  runs: AutopilotRun[],
): AutopilotStatusReport {
  return {
    ...base,
    lastRun: runs.at(-1) ?? null,
    recentRuns: runs,
  };
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("autopilot status snapshot", () => {
  it("publishes only the exact sanitized live schema and derived cap usage", () => {
    const paths = testPaths();
    writeState(
      paths.liveState,
      dailyState({ tradesOpened: 1, realizedPnlUSDT: -0.13 }),
    );

    const report = buildAutopilotStatus({
      mode: "live",
      env: statusEnv(paths, {
        BITGET_API_KEY: "must-not-escape",
        BITGET_SECRET_KEY: "must-not-escape",
        BITGET_PASSPHRASE: "must-not-escape",
      }),
      now: NOW,
    });

    expect(report).toEqual({
      schemaVersion: 1,
      generatedAt: NOW.toISOString(),
      mode: "live",
      entryState: "armed",
      enabled: true,
      killSwitchPresent: false,
      persistentKillTripped: false,
      pendingReconciliation: false,
      cadenceMinutes: 30,
      lastRun: null,
      caps: {
        date: "2026-07-11",
        tradesOpened: 1,
        maxTradesPerDay: 3,
        dailyLossUsedUSDT: 0.13,
        maxDailyLossUSDT: 0.3,
        tradeCapReached: false,
        dailyLossCapReached: false,
      },
      recentRuns: [],
    });
    const serialized = JSON.stringify(report);
    expect(serialized).not.toMatch(
      /api|secret|passphrase|balance|equity|profit|clientOid|orderId|receipt|reason/i,
    );
    expect(serialized).not.toContain("must-not-escape");
  });

  it("derives disabled and touch-file stops without trusting a missing state", () => {
    const paths = testPaths();
    const disabled = buildAutopilotStatus({
      mode: "live",
      env: statusEnv(paths, { AUTO_TRADE_ENABLED: "false" }),
      now: NOW,
    });
    expect(disabled.entryState).toBe("disabled");
    expect(disabled.persistentKillTripped).toBeNull();

    writeFileSync(paths.kill, "");
    const killed = buildAutopilotStatus({
      mode: "live",
      env: statusEnv(paths),
      now: NOW,
    });
    expect(killed.entryState).toBe("kill_switched");
    expect(killed.killSwitchPresent).toBe(true);
    expect(killed.caps.tradesOpened).toBeNull();
  });

  it("maps persistent stops, pending reconciliation, caps, and dry-run mode", () => {
    const paths = testPaths();
    writeState(
      paths.liveState,
      dailyState({
        killSwitchTripped: true,
        killSwitchReason: "private operator reason",
      }),
    );
    expect(
      buildAutopilotStatus({
        mode: "live",
        env: statusEnv(paths),
        now: NOW,
      }).entryState,
    ).toBe("kill_switched");

    writeState(
      paths.liveState,
      dailyState({
        pendingOrder: {
          clientOid: "private-client",
          symbol: "NVDAUSDT",
          reservedAt: "2026-07-11T12:00:00.000Z",
          status: "timeout",
        },
      }),
    );
    const reconciling = buildAutopilotStatus({
      mode: "live",
      env: statusEnv(paths),
      now: NOW,
    });
    expect(reconciling.entryState).toBe("reconciling");
    expect(reconciling.pendingReconciliation).toBe(true);
    expect(JSON.stringify(reconciling)).not.toContain("private-client");

    writeState(paths.liveState);
    expect(
      buildAutopilotStatus({
        mode: "live",
        env: statusEnv(paths, { AUTO_TRADE_MAX_TRADES_PER_DAY: "0" }),
        now: NOW,
      }),
    ).toMatchObject({
      entryState: "cap_reached",
      caps: { tradeCapReached: true },
    });

    writeState(paths.liveState, dailyState({ realizedPnlUSDT: -0.3 }));
    expect(
      buildAutopilotStatus({
        mode: "live",
        env: statusEnv(paths),
        now: NOW,
      }),
    ).toMatchObject({
      entryState: "cap_reached",
      caps: { dailyLossCapReached: true, dailyLossUsedUSDT: 0.3 },
    });

    writeState(paths.dryState);
    expect(
      buildAutopilotStatus({
        mode: "dry_run",
        env: statusEnv(paths),
        now: NOW,
      }).entryState,
    ).toBe("dry_run");
  });

  it("fails the public state closed for missing, corrupt, future, or inaccessible input", () => {
    const paths = testPaths();
    const env = statusEnv(paths);
    const missing = buildAutopilotStatus({ mode: "live", env, now: NOW });
    expect(missing).toMatchObject({
      entryState: "unknown",
      persistentKillTripped: null,
      pendingReconciliation: null,
      caps: { date: null, tradesOpened: null },
    });

    writeFileSync(paths.liveState, "{not-json");
    expect(
      buildAutopilotStatus({ mode: "live", env, now: NOW }).entryState,
    ).toBe("unknown");

    writeState(paths.liveState, dailyState({ date: "2026-07-12" }));
    expect(
      buildAutopilotStatus({ mode: "live", env, now: NOW }).entryState,
    ).toBe("unknown");

    writeState(paths.liveState);
    const unreadableState = buildAutopilotStatus(
      { mode: "live", env, now: NOW },
      {
        readText: (path) => {
          if (path === paths.liveState) {
            throw Object.assign(new Error("denied"), { code: "EACCES" });
          }
          return readFileSync(path, "utf8");
        },
      },
    );
    expect(unreadableState.entryState).toBe("unknown");
    expect(unreadableState.caps.tradesOpened).toBeNull();

    const unreadableKill = buildAutopilotStatus(
      { mode: "live", env, now: NOW },
      {
        killSwitchPresent: () => {
          throw Object.assign(new Error("denied"), { code: "EACCES" });
        },
      },
    );
    expect(unreadableKill.entryState).toBe("unknown");
    expect(unreadableKill.killSwitchPresent).toBeNull();
  });

  it("rolls stale UTC counters in memory while preserving persistent and pending stops", () => {
    const paths = testPaths();
    writeState(
      paths.liveState,
      dailyState({
        date: "2026-07-10",
        tradesOpened: 3,
        realizedPnlUSDT: -0.3,
        killSwitchTripped: true,
        killSwitchReason: "operator stop",
        pendingOrder: {
          clientOid: "private-client",
          symbol: "NVDAUSDT",
          reservedAt: "2026-07-10T23:00:00.000Z",
          status: "timeout",
        },
      }),
    );

    const report = buildAutopilotStatus({
      mode: "live",
      env: statusEnv(paths),
      now: NOW,
    });

    expect(report.entryState).toBe("kill_switched");
    expect(report.pendingReconciliation).toBe(true);
    expect(report.caps).toMatchObject({
      date: "2026-07-11",
      tradesOpened: 0,
      dailyLossUsedUSDT: 0,
      tradeCapReached: false,
      dailyLossCapReached: false,
    });
    expect(JSON.parse(readFileSync(paths.liveState, "utf8")).date).toBe(
      "2026-07-10",
    );
  });

  it("does not publish positive realized PnL and survives invalid configuration", () => {
    const paths = testPaths();
    writeState(paths.liveState, dailyState({ realizedPnlUSDT: 2.5 }));
    const profitable = buildAutopilotStatus({
      mode: "live",
      env: statusEnv(paths),
      now: NOW,
    });
    expect(profitable.caps.dailyLossUsedUSDT).toBe(0);
    expect(JSON.stringify(profitable)).not.toContain("2.5");

    const invalid = buildAutopilotStatus({
      mode: "live",
      env: statusEnv(paths, { AUTO_TRADE_MAX_DAILY_LOSS_USDT: "0" }),
      now: NOW,
    });
    expect(invalid.entryState).toBe("unknown");
    expect(invalid.caps).toEqual({
      date: null,
      tradesOpened: null,
      maxTradesPerDay: null,
      dailyLossUsedUSDT: null,
      maxDailyLossUSDT: null,
      tradeCapReached: null,
      dailyLossCapReached: null,
    });

    const invalidCadence = buildAutopilotStatus({
      mode: "live",
      env: statusEnv(paths, { AUTO_TRADE_CADENCE_MINUTES: "0" }),
      now: NOW,
    });
    expect(invalidCadence.entryState).toBe("armed");
    expect(invalidCadence.cadenceMinutes).toBeNull();
  });
});

describe("autopilot status history and persistence", () => {
  it("preserves, orders, deduplicates, and bounds recent run history", () => {
    const paths = testPaths();
    const env = statusEnv(paths);
    writeState(paths.liveState);
    const base = buildAutopilotStatus({ mode: "live", env, now: NOW });
    const priorRuns = Array.from(
      { length: AUTOPILOT_STATUS_HISTORY_LIMIT },
      (_, index) => run(index),
    );
    writeAutopilotStatus(paths.status, reportWithRuns(base, priorRuns));

    const deduplicated = buildAutopilotStatus({
      mode: "live",
      env,
      now: new Date("2026-07-11T13:00:00.000Z"),
      run: priorRuns[7],
    });
    expect(deduplicated.recentRuns).toEqual(priorRuns);

    const newest = run(8, "blocked");
    const advanced = buildAutopilotStatus({
      mode: "live",
      env,
      now: new Date("2026-07-11T13:01:00.000Z"),
      run: newest,
    });
    expect(advanced.recentRuns).toHaveLength(AUTOPILOT_STATUS_HISTORY_LIMIT);
    expect(advanced.recentRuns[0]).toEqual(priorRuns[1]);
    expect(advanced.lastRun).toEqual(newest);
  });

  it("resets malformed or schema-mismatched history but still publishes the current run", () => {
    const paths = testPaths();
    const env = statusEnv(paths);
    writeState(paths.liveState);
    const current = run(1, "no_signal");

    writeFileSync(paths.status, "{not-json");
    expect(
      buildAutopilotStatus({ mode: "live", env, now: NOW, run: current })
        .recentRuns,
    ).toEqual([current]);

    writeFileSync(paths.status, JSON.stringify({ schemaVersion: 2 }));
    expect(
      buildAutopilotStatus({ mode: "live", env, now: NOW, run: current })
        .recentRuns,
    ).toEqual([current]);
  });

  it("atomically writes parseable mode-0640 output and cleans a failed temporary write", () => {
    const paths = testPaths();
    const env = statusEnv(paths, {
      AUTO_TRADE_STATUS_PATH: join(paths.dir, "nested", "status.json"),
    });
    writeState(paths.liveState);
    const written = publishAutopilotStatus({ mode: "live", env, now: NOW });
    const outputPath = env.AUTO_TRADE_STATUS_PATH as string;

    expect(parseAutopilotStatusReport(JSON.parse(readFileSync(outputPath, "utf8"))))
      .toEqual(written);
    if (process.platform !== "win32") {
      expect(statSync(outputPath).mode & 0o777).toBe(0o640);
    }
    expect(readdirSync(join(paths.dir, "nested"))).toEqual(["status.json"]);

    const blockedPath = join(paths.dir, "blocked-status.json");
    mkdirSync(blockedPath);
    expect(() => writeAutopilotStatus(blockedPath, written)).toThrow();
    expect(
      readdirSync(paths.dir).filter((name) => name.includes(".tmp")),
    ).toEqual([]);
  });

  it("strictly rejects extra public fields and inconsistent last-run state", () => {
    const paths = testPaths();
    writeState(paths.liveState);
    const report = buildAutopilotStatus({
      mode: "live",
      env: statusEnv(paths),
      now: NOW,
    });
    expect(() =>
      parseAutopilotStatusReport({ ...report, reason: "private" }),
    ).toThrow("unexpected field reason");
    expect(() =>
      parseAutopilotStatusReport({
        ...report,
        lastRun: run(1),
        recentRuns: [],
      }),
    ).toThrow("lastRun");
  });

  it("rejects cap and entry-state contradictions before publication", () => {
    const paths = testPaths();
    writeState(paths.liveState);
    const report = buildAutopilotStatus({
      mode: "live",
      env: statusEnv(paths),
      now: NOW,
    });

    expect(() =>
      parseAutopilotStatusReport({
        ...report,
        caps: { ...report.caps, tradeCapReached: true },
      }),
    ).toThrow("tradeCapReached contradicts");
    expect(() =>
      parseAutopilotStatusReport({
        ...report,
        caps: { ...report.caps, dailyLossCapReached: true },
      }),
    ).toThrow("dailyLossCapReached contradicts");
    expect(() =>
      parseAutopilotStatusReport({
        ...report,
        persistentKillTripped: true,
      }),
    ).toThrow("entryState contradicts");
    expect(() =>
      parseAutopilotStatusReport({
        ...report,
        killSwitchPresent: true,
      }),
    ).toThrow("entryState contradicts");
    expect(() =>
      parseAutopilotStatusReport({
        ...report,
        caps: { ...report.caps, maxDailyLossUSDT: null },
      }),
    ).toThrow("partial configuration");
    expect(() =>
      parseAutopilotStatusReport({
        ...report,
        caps: { ...report.caps, date: null },
      }),
    ).toThrow("partial daily-state");
  });
});

describe("auto-trader status wrapper", () => {
  it("publishes only the allowlisted result outcome and returns the original result", async () => {
    const paths = testPaths();
    const published: BuildAutopilotStatusOptions[] = [];
    const times = [
      new Date("2026-07-11T12:00:00.000Z"),
      new Date("2026-07-11T12:00:02.000Z"),
    ];
    const result = {
      mode: "live" as const,
      status: "no_signal" as const,
      reason: "private raw reason",
      symbol: "PRIVATE",
      clientOid: "private-client",
    };

    await expect(
      runAutoTraderWithStatus(
        { mode: "live" },
        {
          env: statusEnv(paths),
          now: () => times.shift() as Date,
          run: async () => result,
          publish: (options) => {
            published.push(options);
            return {} as AutopilotStatusReport;
          },
        },
      ),
    ).resolves.toBe(result);

    expect(published).toHaveLength(1);
    expect(published[0].run).toEqual({
      startedAt: "2026-07-11T12:00:00.000Z",
      completedAt: "2026-07-11T12:00:02.000Z",
      outcome: "no_signal",
    });
    expect(JSON.stringify(published[0].run)).not.toMatch(
      /reason|symbol|clientOid|private/i,
    );
  });

  it("publishes a sanitized error after a runner failure and rethrows the original error", async () => {
    const paths = testPaths();
    const published: BuildAutopilotStatusOptions[] = [];
    const failure = new Error("secret exchange detail");
    const times = [
      new Date("2026-07-11T12:00:00.000Z"),
      new Date("2026-07-11T12:00:03.000Z"),
    ];

    await expect(
      runAutoTraderWithStatus(
        { mode: "live" },
        {
          env: statusEnv(paths),
          now: () => times.shift() as Date,
          run: async () => {
            throw failure;
          },
          publish: (options) => {
            published.push(options);
            return {} as AutopilotStatusReport;
          },
        },
      ),
    ).rejects.toBe(failure);

    expect(published).toHaveLength(1);
    expect(published[0].run?.outcome).toBe("error");
    expect(JSON.stringify(published[0].run)).not.toContain(failure.message);
  });

  it("does not rewrite a successful run as error when publication fails", async () => {
    const paths = testPaths();
    const publicationFailure = new Error("status path unavailable");
    let publishAttempts = 0;
    const times = [
      new Date("2026-07-11T12:00:00.000Z"),
      new Date("2026-07-11T12:00:01.000Z"),
    ];

    await expect(
      runAutoTraderWithStatus(
        { mode: "live" },
        {
          env: statusEnv(paths),
          now: () => times.shift() as Date,
          run: async () => ({
            mode: "live",
            status: "submitted",
            reason: "submitted",
          }),
          publish: () => {
            publishAttempts += 1;
            throw publicationFailure;
          },
        },
      ),
    ).rejects.toBe(publicationFailure);
    expect(publishAttempts).toBe(1);
  });

  it("retains both failures when the runner and error publication fail", async () => {
    const paths = testPaths();
    const runFailure = new Error("runner failed");
    const publishFailure = new Error("publisher failed");
    const times = [
      new Date("2026-07-11T12:00:00.000Z"),
      new Date("2026-07-11T12:00:01.000Z"),
    ];

    const caught = await runAutoTraderWithStatus(
      { mode: "live" },
      {
        env: statusEnv(paths),
        now: () => times.shift() as Date,
        run: async () => {
          throw runFailure;
        },
        publish: () => {
          throw publishFailure;
        },
      },
    ).catch((error: unknown) => error);

    expect(caught).toBeInstanceOf(AggregateError);
    expect((caught as AggregateError).errors).toEqual([
      runFailure,
      publishFailure,
    ]);
  });
});
