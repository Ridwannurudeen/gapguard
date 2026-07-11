import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  acknowledgePendingOrderEvidence,
  acquireAutoTraderLock,
  clearPendingOrder,
  clearPersistentKillSwitch,
  createAutoTraderState,
  evaluateGate,
  getTerminalPendingOrder,
  markPendingOrderTerminal,
  parseAutoTraderConfig,
  readAutoTraderState,
  recordTradeOpened,
  releaseAutoTraderLock,
  reservePendingOrder,
  rollAutoTraderState,
  setReconciledPnl,
  setReconciledTradeCount,
  stagePendingOrderEvidence,
  tripKillSwitch,
  updatePendingOrder,
  writeAutoTraderState,
  type AutoTraderConfig,
  type AutoTraderDailyState,
} from "../src/autoTraderState";

const NOW = new Date("2026-07-11T00:10:00.000Z");
const NEXT_DAY = new Date("2026-07-12T00:10:00.000Z");
const tempDirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "gapguard-auto-state-"));
  tempDirs.push(dir);
  return dir;
}

function config(overrides: Partial<AutoTraderConfig> = {}): AutoTraderConfig {
  return {
    enabled: true,
    maxTradesPerDay: 3,
    maxDailyLossUSDT: 0.3,
    statePath: "state/auto-trader-daily.json",
    killSwitchPath: "state/AUTO_TRADE_KILL",
    lockPath: "state/auto-trader.lock",
    maxPositionPct: 0.2,
    lockMaxAgeMs: 600_000,
    ...overrides,
  };
}

function state(
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

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("auto-trader configuration", () => {
  it("uses fail-closed defaults and requires the exact enabled value", () => {
    expect(parseAutoTraderConfig({})).toEqual({
      enabled: false,
      maxTradesPerDay: 3,
      maxDailyLossUSDT: 0.3,
      statePath: "state/auto-trader-daily.json",
      killSwitchPath: "state/AUTO_TRADE_KILL",
      lockPath: "state/auto-trader.lock",
      maxPositionPct: 0.2,
      lockMaxAgeMs: 600_000,
    });
    expect(
      parseAutoTraderConfig({
        AUTO_TRADE_ENABLED: "TRUE",
        AUTO_TRADE_MAX_TRADES_PER_DAY: "0",
      }),
    ).toMatchObject({ enabled: false, maxTradesPerDay: 0 });
    expect(parseAutoTraderConfig({ AUTO_TRADE_ENABLED: "true" }).enabled).toBe(
      true,
    );
  });

  it.each([
    ["AUTO_TRADE_MAX_TRADES_PER_DAY", ""],
    ["AUTO_TRADE_MAX_TRADES_PER_DAY", "-1"],
    ["AUTO_TRADE_MAX_TRADES_PER_DAY", "1.5"],
    ["AUTO_TRADE_MAX_DAILY_LOSS_USDT", "0"],
    ["AUTO_TRADE_MAX_DAILY_LOSS_USDT", "NaN"],
    ["AUTO_TRADE_MAX_POSITION_PCT", "0"],
    ["AUTO_TRADE_MAX_POSITION_PCT", "1.1"],
    ["AUTO_TRADE_LOCK_MAX_AGE_MS", "0"],
  ])("rejects invalid %s=%s", (name, value) => {
    expect(() => parseAutoTraderConfig({ [name]: value })).toThrow(name);
  });

  it("rejects empty state, kill-switch, and lock paths", () => {
    for (const name of [
      "AUTO_TRADE_STATE_PATH",
      "AUTO_TRADE_KILL_SWITCH_PATH",
      "AUTO_TRADE_LOCK_PATH",
    ]) {
      expect(() => parseAutoTraderConfig({ [name]: "   " })).toThrow(name);
    }
  });
});

describe("auto-trader daily state", () => {
  it("rolls UTC counters while preserving persistent stops and reservations", () => {
    const original = state({
      tradesOpened: 2,
      realizedPnlUSDT: -0.3,
      killSwitchTripped: true,
      killSwitchReason: "daily realized-trade-PnL cap reached",
      pendingOrder: {
        clientOid: "gg-auto-1",
        symbol: "NVDAUSDT",
        reservedAt: "2026-07-11T00:00:00.000Z",
        status: "timeout",
      },
    });

    const rolled = rollAutoTraderState(original, NEXT_DAY);

    expect(rolled).toEqual({
      ...original,
      date: "2026-07-12",
      tradesOpened: 0,
      realizedPnlUSDT: 0,
    });
    expect(original.date).toBe("2026-07-11");
    expect(original.tradesOpened).toBe(2);
  });

  it("fails closed when the clock moves behind a future-dated state", () => {
    expect(() =>
      rollAutoTraderState(state({ date: "2026-07-12", tradesOpened: 2 }), NOW),
    ).toThrow("future-dated");
  });

  it("applies gate precedence before allowing a new order", () => {
    const blocked = state({
      tradesOpened: 3,
      realizedPnlUSDT: -0.3,
      killSwitchTripped: true,
      killSwitchReason: "operator halt",
      pendingOrder: {
        clientOid: "gg-auto-1",
        symbol: "NVDAUSDT",
        reservedAt: "2026-07-11T00:00:00.000Z",
        status: "submitted",
      },
    });

    expect(
      evaluateGate(blocked, config({ enabled: false }), NOW, true).reason,
    ).toContain("kill-switch file");
    expect(
      evaluateGate(blocked, config({ enabled: false }), NOW, false).reason,
    ).toContain("disabled");
    expect(evaluateGate(blocked, config(), NOW, false).reason).toContain(
      "operator halt",
    );
    expect(
      evaluateGate(
        { ...blocked, killSwitchTripped: false, killSwitchReason: null },
        config(),
        NOW,
        false,
      ).reason,
    ).toContain("pending order gg-auto-1");
    expect(
      evaluateGate(
        {
          ...blocked,
          killSwitchTripped: false,
          killSwitchReason: null,
          pendingOrder: null,
        },
        config(),
        NOW,
        false,
      ).reason,
    ).toContain("trade-count cap");
    expect(
      evaluateGate(
        {
          ...blocked,
          tradesOpened: 0,
          killSwitchTripped: false,
          killSwitchReason: null,
          pendingOrder: null,
        },
        config(),
        NOW,
        false,
      ).reason,
    ).toContain("daily realized-trade-PnL cap");
    expect(evaluateGate(state(), config(), NOW, false)).toEqual({
      allowed: true,
    });
  });

  it("blocks immediately when the trade-count cap is zero", () => {
    expect(
      evaluateGate(state(), config({ maxTradesPerDay: 0 }), NOW, false),
    ).toMatchObject({ allowed: false });
  });

  it("persistently trips when reconciled loss reaches the flat USDT cap", () => {
    const original = state();
    const reconciled = setReconciledPnl(original, -0.3, config());
    const rolled = rollAutoTraderState(reconciled, NEXT_DAY);

    expect(reconciled.realizedPnlUSDT).toBe(-0.3);
    expect(reconciled.killSwitchTripped).toBe(true);
    expect(reconciled.killSwitchReason).toContain(
      "daily realized-trade-PnL cap",
    );
    expect(rolled.killSwitchTripped).toBe(true);
    expect(rolled.killSwitchReason).toBe(reconciled.killSwitchReason);
    expect(original).toEqual(state());
  });

  it("updates counters and explicit kill switches without mutation", () => {
    const original = state();
    const counted = recordTradeOpened(original);
    const tripped = tripKillSwitch(counted, "manual operator stop");

    expect(counted.tradesOpened).toBe(1);
    expect(tripped).toMatchObject({
      killSwitchTripped: true,
      killSwitchReason: "manual operator stop",
    });
    expect(original).toEqual(state());
  });

  it("clears only the persistent trip while preserving counters and reservations", () => {
    const tripped = state({
      tradesOpened: 2,
      realizedPnlUSDT: -0.1,
      killSwitchTripped: true,
      killSwitchReason: "operator stop",
      pendingOrder: {
        clientOid: "ggauto-preserved",
        symbol: "NVDAUSDT",
        reservedAt: "2026-07-11T00:00:00.000Z",
        status: "timeout",
      },
    });

    expect(clearPersistentKillSwitch(tripped)).toEqual({
      ...tripped,
      killSwitchTripped: false,
      killSwitchReason: null,
    });
    expect(tripped.killSwitchTripped).toBe(true);
  });

  it("reconciles an exchange-derived daily trade count idempotently", () => {
    const original = state({ tradesOpened: 1 });
    const reconciled = setReconciledTradeCount(original, 3);

    expect(reconciled.tradesOpened).toBe(3);
    expect(setReconciledTradeCount(reconciled, 3)).toEqual(reconciled);
    expect(setReconciledTradeCount(reconciled, 2)).toEqual(reconciled);
    expect(() => setReconciledTradeCount(original, -1)).toThrow(
      "non-negative integer",
    );
    expect(original.tradesOpened).toBe(1);
  });

  it("atomically writes, strictly reads, and rolls state files", () => {
    const dir = tempDir();
    const path = join(dir, "nested", "auto-trader-daily.json");
    const original = reservePendingOrder(state({ tradesOpened: 2 }), {
      clientOid: "gg-auto-durable",
      symbol: "NVDAUSDT",
      reservedAt: "2026-07-11T00:00:00.000Z",
    });

    writeAutoTraderState(path, original);
    writeAutoTraderState(path, { ...original, tradesOpened: 3 });

    expect(readAutoTraderState(path, NOW).tradesOpened).toBe(3);
    expect(readAutoTraderState(path, NEXT_DAY)).toMatchObject({
      date: "2026-07-12",
      tradesOpened: 0,
      pendingOrder: {
        clientOid: "gg-auto-durable",
        status: "reserved",
      },
    });
    expect(readdirSync(join(dir, "nested"))).toEqual([
      "auto-trader-daily.json",
    ]);
  });

  it("creates an in-memory default for a missing file and fails closed on malformed state", () => {
    const dir = tempDir();
    const path = join(dir, "auto-trader-daily.json");

    expect(readAutoTraderState(path, NOW)).toEqual(createAutoTraderState(NOW));
    writeFileSync(path, "{not-json");
    expect(() => readAutoTraderState(path, NOW)).toThrow(
      "invalid auto-trader state",
    );
    writeFileSync(path, JSON.stringify({ ...state(), tradesOpened: -1 }));
    expect(() => readAutoTraderState(path, NOW)).toThrow("tradesOpened");
  });

  it("moves a durable reservation through submitted, timeout, and clear states", () => {
    const original = state();
    const reserved = reservePendingOrder(original, {
      clientOid: "gg-auto-1",
      symbol: "NVDAUSDT",
      reservedAt: "2026-07-11T00:00:00.000Z",
    });
    const submitted = updatePendingOrder(reserved, "gg-auto-1", {
      status: "submitted",
      orderId: "bitget-order-1",
    });
    const timedOut = updatePendingOrder(reserved, "gg-auto-1", {
      status: "timeout",
    });
    const cleared = clearPendingOrder(submitted, "gg-auto-1");

    expect(original.pendingOrder).toBeNull();
    expect(reserved.pendingOrder?.status).toBe("reserved");
    expect(submitted.pendingOrder).toMatchObject({
      status: "submitted",
      orderId: "bitget-order-1",
    });
    expect(timedOut.pendingOrder?.status).toBe("timeout");
    expect(cleared.pendingOrder).toBeNull();
    expect(submitted.pendingOrder?.status).toBe("submitted");
    expect(() =>
      reservePendingOrder(reserved, {
        clientOid: "gg-auto-2",
        symbol: "AAPLUSDT",
        reservedAt: "2026-07-11T00:01:00.000Z",
      }),
    ).toThrow("pending order already exists");
    expect(() => clearPendingOrder(submitted, "wrong-oid")).toThrow(
      "does not match",
    );
  });

  it("keeps reconciled terminal outcomes pending until evidence is acknowledged", () => {
    const reserved = reservePendingOrder(state(), {
      clientOid: "ggauto-terminal",
      symbol: "NVDAUSDT",
      reservedAt: "2026-07-11T00:00:00.000Z",
    });
    const filled = markPendingOrderTerminal(reserved, "ggauto-terminal", {
      status: "filled",
      orderId: "bitget-order-filled",
    });
    const cancelled = markPendingOrderTerminal(reserved, "ggauto-terminal", {
      status: "cancelled",
      orderId: "bitget-order-cancelled",
    });

    expect(getTerminalPendingOrder(filled)).toEqual(filled.pendingOrder);
    expect(getTerminalPendingOrder(cancelled)).toEqual(cancelled.pendingOrder);
    expect(getTerminalPendingOrder(reserved)).toBeNull();
    expect(evaluateGate(filled, config(), NOW, false).reason).toContain(
      "pending order ggauto-terminal is filled",
    );
    expect(() => clearPendingOrder(filled, "ggauto-terminal")).toThrow(
      "requires evidence acknowledgement",
    );
    expect(() =>
      markPendingOrderTerminal(reserved, "ggauto-terminal", {
        status: "filled",
        orderId: "",
      }),
    ).toThrow("orderId");
    expect(() =>
      markPendingOrderTerminal(reserved, "wrong-oid", {
        status: "filled",
        orderId: "bitget-order-filled",
      }),
    ).toThrow("does not match");
  });

  it("persists a terminal outcome across a state-file retry only with staged evidence", () => {
    const path = join(tempDir(), "auto-trader-daily.json");
    const terminal = markPendingOrderTerminal(
      reservePendingOrder(state(), {
        clientOid: "ggauto-retry",
        symbol: "NVDAUSDT",
        reservedAt: "2026-07-11T00:00:00.000Z",
      }),
      "ggauto-retry",
      { status: "filled", orderId: "bitget-order-retry" },
    );
    expect(() =>
      stagePendingOrderEvidence(terminal, "ggauto-retry", {
        ts: "2026-07-11T00:00:01.000Z",
        trigger: "auto",
        mode: "live",
        status: "filled",
        eventId: "ggauto-outcome-missing-order-id",
        symbol: "NVDAUSDT",
        clientOid: "ggauto-retry",
      }),
    ).toThrow("orderId does not match");
    const staged = stagePendingOrderEvidence(terminal, "ggauto-retry", {
      ts: "2026-07-11T00:00:01.000Z",
      trigger: "auto",
      mode: "live",
      status: "filled",
      eventId: "ggauto-outcome-retry",
      symbol: "NVDAUSDT",
      clientOid: "ggauto-retry",
      orderId: "bitget-order-retry",
    });

    expect(() => writeAutoTraderState(path, terminal)).toThrow(
      "terminal pending order requires staged evidence",
    );
    writeAutoTraderState(path, staged);

    expect(readAutoTraderState(path, NOW).pendingOrder).toEqual(
      staged.pendingOrder,
    );
  });

  it("durably stages result evidence and refuses to clear it unacknowledged", () => {
    const path = join(tempDir(), "auto-trader-daily.json");
    const terminal = markPendingOrderTerminal(
      reservePendingOrder(state(), {
        clientOid: "ggauto-evidence-pending",
        symbol: "NVDAUSDT",
        reservedAt: "2026-07-11T00:00:00.000Z",
      }),
      "ggauto-evidence-pending",
      { status: "filled", orderId: "bitget-order-evidence-pending" },
    );
    const staged = stagePendingOrderEvidence(
      terminal,
      "ggauto-evidence-pending",
      {
        ts: "2026-07-11T00:00:01.000Z",
        trigger: "auto",
        mode: "live",
        status: "filled",
        eventId: "ggauto-outcome-filled",
        symbol: "NVDAUSDT",
        clientOid: "ggauto-evidence-pending",
        orderId: "bitget-order-evidence-pending",
        result: { status: "filled" },
      },
    );

    writeAutoTraderState(path, staged);
    const reloaded = readAutoTraderState(path, NOW);

    expect(reloaded.pendingOrder?.evidence).toEqual(
      staged.pendingOrder?.evidence,
    );
    expect(() =>
      clearPendingOrder(reloaded, "ggauto-evidence-pending"),
    ).toThrow("unacknowledged evidence");
    expect(() =>
      acknowledgePendingOrderEvidence(
        reloaded,
        "ggauto-evidence-pending",
        "wrong-event",
      ),
    ).toThrow("does not match");
    expect(
      acknowledgePendingOrderEvidence(
        reloaded,
        "ggauto-evidence-pending",
        "ggauto-outcome-filled",
      ).pendingOrder,
    ).toBeNull();
  });

  it("acknowledges error evidence without clearing an ambiguous reservation", () => {
    const timedOut = updatePendingOrder(
      reservePendingOrder(state(), {
        clientOid: "ggauto-error-pending",
        symbol: "AAPLUSDT",
        reservedAt: "2026-07-11T00:00:00.000Z",
      }),
      "ggauto-error-pending",
      { status: "timeout" },
    );
    const staged = stagePendingOrderEvidence(timedOut, "ggauto-error-pending", {
      ts: "2026-07-11T00:00:01.000Z",
      trigger: "auto",
      mode: "live",
      status: "error",
      eventId: "ggauto-outcome-error",
      symbol: "AAPLUSDT",
      clientOid: "ggauto-error-pending",
      error: "broker result unknown",
    });

    const acknowledged = acknowledgePendingOrderEvidence(
      staged,
      "ggauto-error-pending",
      "ggauto-outcome-error",
    );

    expect(acknowledged.pendingOrder).toMatchObject({
      clientOid: "ggauto-error-pending",
      status: "timeout",
    });
    expect(acknowledged.pendingOrder?.evidence).toBeUndefined();
    expect(staged.pendingOrder?.evidence).toBeDefined();
  });

  it("rejects mismatched or non-live evidence at the state boundary", () => {
    const reserved = reservePendingOrder(state(), {
      clientOid: "ggauto-strict-evidence",
      symbol: "NVDAUSDT",
      reservedAt: "2026-07-11T00:00:00.000Z",
    });
    const base = {
      ts: "2026-07-11T00:00:01.000Z",
      trigger: "auto" as const,
      mode: "live" as const,
      status: "error" as const,
      eventId: "ggauto-outcome-strict",
      symbol: "NVDAUSDT",
      clientOid: "ggauto-strict-evidence",
    };

    expect(() =>
      stagePendingOrderEvidence(reserved, "ggauto-strict-evidence", {
        ...base,
        clientOid: "different-client",
      }),
    ).toThrow("clientOid");
    expect(() =>
      stagePendingOrderEvidence(reserved, "ggauto-strict-evidence", {
        ...base,
        mode: "dry_run",
        status: "dry_run",
      }),
    ).toThrow("mode");
  });
});

describe("auto-trader lock", () => {
  it("blocks overlap and checks ownership before release", () => {
    const path = join(tempDir(), "auto-trader.lock");
    const first = acquireAutoTraderLock(path, NOW, 600_000, {
      ownerToken: "owner-1",
      pid: 101,
    });
    const second = acquireAutoTraderLock(path, NOW, 600_000, {
      ownerToken: "owner-2",
      pid: 202,
    });

    expect(first.acquired).toBe(true);
    expect(second).toMatchObject({ acquired: false });
    if (!first.acquired) throw new Error("expected first lock acquisition");
    expect(
      releaseAutoTraderLock({ ...first.lock, ownerToken: "wrong-owner" }),
    ).toBe(false);
    expect(existsSync(path)).toBe(true);
    expect(releaseAutoTraderLock(first.lock)).toBe(true);
    expect(existsSync(path)).toBe(false);
  });

  it("blocks on a valid stale lock until an operator removes it", () => {
    const path = join(tempDir(), "auto-trader.lock");
    writeFileSync(
      path,
      `${JSON.stringify({
        ownerToken: "stale-owner",
        pid: 101,
        startedAt: "2026-07-10T23:59:59.999Z",
      })}\n`,
    );

    const result = acquireAutoTraderLock(path, NOW, 600_000, {
      ownerToken: "new-owner",
      pid: 202,
    });

    expect(result).toMatchObject({ acquired: false });
    if (result.acquired) throw new Error("expected stale lock to block");
    expect(result.reason).toContain("stale");
    expect(result.reason).toContain("manual removal");
    expect(JSON.parse(readFileSync(path, "utf8"))).toMatchObject({
      ownerToken: "stale-owner",
      pid: 101,
    });

    unlinkSync(path);
    const retried = acquireAutoTraderLock(path, NOW, 600_000, {
      ownerToken: "new-owner",
      pid: 202,
    });
    expect(retried).toMatchObject({ acquired: true, recoveredStale: false });
    if (!retried.acquired) throw new Error("expected manual cleanup to re-arm");
    expect(releaseAutoTraderLock(retried.lock)).toBe(true);
  });

  it("blocks on a malformed lock instead of treating it as stale", () => {
    const path = join(tempDir(), "auto-trader.lock");
    writeFileSync(path, "{not-json");

    const result = acquireAutoTraderLock(path, NOW, 600_000, {
      ownerToken: "new-owner",
      pid: 202,
    });

    expect(result).toMatchObject({ acquired: false });
    if (result.acquired) throw new Error("expected malformed lock to block");
    expect(result.reason).toContain("malformed");
    expect(readFileSync(path, "utf8")).toBe("{not-json");
  });
});
