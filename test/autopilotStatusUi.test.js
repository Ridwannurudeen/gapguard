import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  autopilotCapRatio,
  autopilotEntryLabel,
  autopilotOutcomeLabel,
  autopilotStatusFreshness,
  formatAutopilotRelativeTime,
  parseAutopilotStatus,
} from "../public/autopilot-status.js";

const ENTRY_STATES = [
  "armed",
  "dry_run",
  "disabled",
  "kill_switched",
  "cap_reached",
  "reconciling",
  "unknown",
];

const OUTCOMES = [
  "disabled",
  "blocked",
  "no_signal",
  "rearmed",
  "dry_run",
  "submitted",
  "filled",
  "cancelled",
  "timeout",
  "error",
];

function report() {
  const lastRun = {
    startedAt: "2026-07-11T11:29:00.000Z",
    completedAt: "2026-07-11T11:30:00.000Z",
    outcome: "no_signal",
  };
  return {
    schemaVersion: 1,
    generatedAt: "2026-07-11T11:30:00.000Z",
    mode: "live",
    entryState: "armed",
    enabled: true,
    killSwitchPresent: false,
    persistentKillTripped: false,
    pendingReconciliation: false,
    cadenceMinutes: 30,
    lastRun,
    caps: {
      date: "2026-07-11",
      tradesOpened: 1,
      maxTradesPerDay: 3,
      dailyLossUsedUSDT: 0.13,
      maxDailyLossUSDT: 0.3,
      tradeCapReached: false,
      dailyLossCapReached: false,
    },
    recentRuns: [lastRun],
  };
}

describe("autopilot status parser", () => {
  it("returns a sanitized deep copy of a valid report", () => {
    const input = report();
    const parsed = parseAutopilotStatus(input);

    expect(parsed).toEqual(input);
    expect(parsed).not.toBe(input);
    expect(parsed.caps).not.toBe(input.caps);
    expect(parsed.lastRun).not.toBe(input.lastRun);
    expect(parsed.recentRuns).not.toBe(input.recentRuns);
    expect(parsed.recentRuns[0]).not.toBe(input.recentRuns[0]);

    input.caps.tradesOpened = 3;
    input.recentRuns[0].outcome = "error";
    expect(parsed.caps.tradesOpened).toBe(1);
    expect(parsed.recentRuns[0].outcome).toBe("no_signal");
  });

  it.each([
    ["armed", (input) => input],
    [
      "dry_run",
      (input) => ({ ...input, mode: "dry_run", entryState: "dry_run" }),
    ],
    [
      "disabled",
      (input) => ({ ...input, enabled: false, entryState: "disabled" }),
    ],
    [
      "kill_switched",
      (input) => ({
        ...input,
        killSwitchPresent: true,
        entryState: "kill_switched",
      }),
    ],
    [
      "cap_reached",
      (input) => ({
        ...input,
        entryState: "cap_reached",
        caps: {
          ...input.caps,
          tradesOpened: input.caps.maxTradesPerDay,
          tradeCapReached: true,
        },
      }),
    ],
    [
      "reconciling",
      (input) => ({
        ...input,
        pendingReconciliation: true,
        entryState: "reconciling",
      }),
    ],
    [
      "unknown",
      (input) => ({
        ...input,
        entryState: "unknown",
        persistentKillTripped: null,
        pendingReconciliation: null,
        caps: {
          ...input.caps,
          date: null,
          tradesOpened: null,
          dailyLossUsedUSDT: null,
          tradeCapReached: null,
          dailyLossCapReached: null,
        },
      }),
    ],
  ])("accepts coherent entry state %s", (entryState, build) => {
    expect(parseAutopilotStatus(build(report())).entryState).toBe(entryState);
  });

  it.each(OUTCOMES)("accepts run outcome %s", (outcome) => {
    const input = report();
    input.lastRun = { ...input.lastRun, outcome };
    input.recentRuns = [{ ...input.lastRun }];
    expect(parseAutopilotStatus(input).lastRun.outcome).toBe(outcome);
  });

  it("accepts the fully unknown nullable snapshot", () => {
    const input = report();
    input.entryState = "unknown";
    input.killSwitchPresent = null;
    input.persistentKillTripped = null;
    input.pendingReconciliation = null;
    input.cadenceMinutes = null;
    input.lastRun = null;
    input.caps = Object.fromEntries(
      Object.keys(input.caps).map((key) => [key, null]),
    );
    input.recentRuns = [];

    expect(parseAutopilotStatus(input)).toEqual(input);
  });

  it.each([
    ["wrong schema", (input) => (input.schemaVersion = 2)],
    ["missing field", (input) => delete input.enabled],
    ["extra top-level field", (input) => (input.accountId = "private")],
    ["secret-like injected field", (input) => (input.API_SECRET = "<script>x</script>")],
    ["extra cap field", (input) => (input.caps.balance = 20)],
    ["extra run field", (input) => (input.lastRun.detail = "private")],
    ["invalid mode", (input) => (input.mode = "paper")],
    ["invalid state", (input) => (input.entryState = "ready")],
    ["invalid outcome", (input) => (input.lastRun.outcome = "partial")],
    ["invalid boolean", (input) => (input.enabled = "true")],
    ["invalid nullable boolean", (input) => (input.killSwitchPresent = 0)],
    ["invalid timestamp", (input) => (input.generatedAt = "not-a-date")],
    ["non-canonical timestamp", (input) => (input.generatedAt = "2026-07-11T11:30:00Z")],
    ["invalid UTC date", (input) => (input.caps.date = "2026-02-30")],
    ["negative count", (input) => (input.caps.tradesOpened = -1)],
    ["fractional count", (input) => (input.caps.maxTradesPerDay = 1.5)],
    ["negative loss", (input) => (input.caps.dailyLossUsedUSDT = -0.1)],
    ["non-finite loss", (input) => (input.caps.maxDailyLossUSDT = Infinity)],
    ["zero loss stop", (input) => (input.caps.maxDailyLossUSDT = 0)],
    ["negative cadence", (input) => (input.cadenceMinutes = -1)],
    ["zero cadence", (input) => (input.cadenceMinutes = 0)],
    ["fractional cadence", (input) => (input.cadenceMinutes = 0.5)],
    ["run ends before start", (input) => (input.lastRun.completedAt = "2026-07-11T11:28:00.000Z")],
    ["partial configuration", (input) => (input.caps.maxDailyLossUSDT = null)],
    ["partial daily state", (input) => (input.caps.date = null)],
  ])("rejects %s", (_name, mutate) => {
    const input = report();
    mutate(input);
    expect(() => parseAutopilotStatus(input)).toThrow();
  });

  it("rejects duplicate, unordered, oversized, or mismatched run histories", () => {
    const duplicate = report();
    duplicate.recentRuns = [duplicate.lastRun, { ...duplicate.lastRun }];
    expect(() => parseAutopilotStatus(duplicate)).toThrow(/duplicated/);

    const unordered = report();
    const older = {
      startedAt: "2026-07-11T10:00:00.000Z",
      completedAt: "2026-07-11T10:01:00.000Z",
      outcome: "blocked",
    };
    unordered.recentRuns = [unordered.lastRun, older];
    unordered.lastRun = older;
    expect(() => parseAutopilotStatus(unordered)).toThrow(/chronological/);

    const oversized = report();
    oversized.recentRuns = Array.from({ length: 9 }, (_, index) => ({
      startedAt: `2026-07-11T0${index}:00:00.000Z`,
      completedAt: `2026-07-11T0${index}:01:00.000Z`,
      outcome: "no_signal",
    }));
    oversized.lastRun = oversized.recentRuns.at(-1);
    expect(() => parseAutopilotStatus(oversized)).toThrow(/exceed 8/);

    const mismatch = report();
    mismatch.lastRun = { ...mismatch.lastRun, outcome: "error" };
    expect(() => parseAutopilotStatus(mismatch)).toThrow(/newest recent run/);
  });

  it.each([
    ["disabled", (input) => (input.enabled = false)],
    ["kill-switched", (input) => (input.killSwitchPresent = true)],
    ["persistently killed", (input) => (input.persistentKillTripped = true)],
    ["reconciling", (input) => (input.pendingReconciliation = true)],
    ["trade-capped", (input) => {
      input.caps.tradesOpened = input.caps.maxTradesPerDay;
      input.caps.tradeCapReached = true;
    }],
    ["loss-capped", (input) => {
      input.caps.dailyLossUsedUSDT = input.caps.maxDailyLossUSDT;
      input.caps.dailyLossCapReached = true;
    }],
    ["dry-run", (input) => (input.mode = "dry_run")],
    ["unknown", (input) => {
      input.killSwitchPresent = null;
    }],
  ])("rejects an armed claim over a %s snapshot", (_name, mutate) => {
    const input = report();
    mutate(input);
    expect(() => parseAutopilotStatus(input)).toThrow(/entryState/);
  });

  it("rejects cap flags that contradict known or unknown cap values", () => {
    const falseTradeFlag = report();
    falseTradeFlag.caps.tradesOpened = falseTradeFlag.caps.maxTradesPerDay;
    expect(() => parseAutopilotStatus(falseTradeFlag)).toThrow(/contradicts/);

    const falseLossFlag = report();
    falseLossFlag.caps.dailyLossUsedUSDT = falseLossFlag.caps.maxDailyLossUSDT;
    expect(() => parseAutopilotStatus(falseLossFlag)).toThrow(/contradicts/);

    const unknownValues = report();
    unknownValues.caps.tradesOpened = null;
    expect(() => parseAutopilotStatus(unknownValues)).toThrow(/must be null/);
  });

  it.each([
    ["disabled", (input) => (input.enabled = false)],
    ["kill_switched", (input) => (input.killSwitchPresent = true)],
    ["reconciling", (input) => (input.pendingReconciliation = true)],
    ["cap_reached", (input) => {
      input.caps.tradesOpened = input.caps.maxTradesPerDay;
      input.caps.tradeCapReached = true;
    }],
    ["dry_run", (input) => (input.mode = "dry_run")],
    ["unknown", (input) => {
      input.persistentKillTripped = null;
      input.pendingReconciliation = null;
      input.caps.date = null;
      input.caps.tradesOpened = null;
      input.caps.dailyLossUsedUSDT = null;
      input.caps.tradeCapReached = null;
      input.caps.dailyLossCapReached = null;
    }],
  ])("accepts coherent %s snapshots", (entryState, mutate) => {
    const input = report();
    mutate(input);
    input.entryState = entryState;
    expect(parseAutopilotStatus(input).entryState).toBe(entryState);
  });
});

describe("autopilot status UI helpers", () => {
  const now = "2026-07-11T12:00:00.000Z";

  it("uses cadence*2+5 freshness, the 65-minute fallback, and clock-skew guard", () => {
    const input = parseAutopilotStatus(report());
    expect(autopilotStatusFreshness(input, now)).toEqual({
      fresh: true,
      ageMinutes: 30,
      maxAgeMinutes: 65,
    });

    expect(
      autopilotStatusFreshness(
        { ...input, generatedAt: "2026-07-11T10:54:59.000Z" },
        now,
      ).fresh,
    ).toBe(false);
    expect(
      autopilotStatusFreshness(
        { ...input, cadenceMinutes: null, generatedAt: "2026-07-11T10:55:00.000Z" },
        now,
      ),
    ).toEqual({ fresh: true, ageMinutes: 65, maxAgeMinutes: 65 });
    expect(
      autopilotStatusFreshness(
        { ...input, generatedAt: "2026-07-11T12:00:59.000Z" },
        now,
      ).fresh,
    ).toBe(true);
    expect(
      autopilotStatusFreshness(
        { ...input, generatedAt: "2026-07-11T12:01:01.000Z" },
        now,
      ).fresh,
    ).toBe(false);
  });

  it("formats past, present, and future relative times", () => {
    expect(formatAutopilotRelativeTime("2026-07-11T11:59:30.000Z", now)).toBe(
      "just now",
    );
    expect(formatAutopilotRelativeTime("2026-07-11T11:58:00.000Z", now)).toBe(
      "2 min ago",
    );
    expect(formatAutopilotRelativeTime("2026-07-11T10:00:00.000Z", now)).toBe(
      "2 hr ago",
    );
    expect(formatAutopilotRelativeTime("2026-07-09T12:00:00.000Z", now)).toBe(
      "2 days ago",
    );
    expect(formatAutopilotRelativeTime("2026-07-11T12:02:00.000Z", now)).toBe(
      "in 2 min",
    );
  });

  it("returns null, full, or clamped cap ratios without dividing by zero", () => {
    expect(autopilotCapRatio(0, null)).toBeNull();
    expect(autopilotCapRatio(null, 3)).toBeNull();
    expect(autopilotCapRatio(0, 0)).toBe(1);
    expect(autopilotCapRatio(1, 0)).toBe(1);
    expect(autopilotCapRatio(1, 4)).toBe(0.25);
    expect(autopilotCapRatio(8, 4)).toBe(1);
    expect(() => autopilotCapRatio(-1, 4)).toThrow();
  });

  it("labels every entry state and run outcome", () => {
    expect(ENTRY_STATES.map(autopilotEntryLabel)).toEqual([
      "Armed",
      "Dry run",
      "Disabled",
      "Kill switch active",
      "Daily cap reached",
      "Reconciling",
      "State unavailable",
    ]);
    expect(OUTCOMES.map(autopilotOutcomeLabel)).toEqual([
      "Disabled",
      "Blocked",
      "No signal",
      "Rearmed",
      "Dry run",
      "Submitted",
      "Filled",
      "Cancelled",
      "Timed out",
      "Error",
    ]);
    expect(() => autopilotEntryLabel("ready")).toThrow();
    expect(() => autopilotOutcomeLabel("partial")).toThrow();
  });
});

describe("Arena Mission Control source contract", () => {
  const arena = readFileSync("public/arena.html", "utf8");

  it("imports the shared parser and fetches only the same-origin static feed", () => {
    expect(arena).toContain('from "./autopilot-status.js"');
    expect(arena).toContain('fetch("autopilot-status.json", { cache: "no-store" })');
    expect(arena).not.toMatch(/api\.bitget|BITGET_|secret|passphrase/i);
  });

  it("keeps missing or malformed feeds claim-free and uses DOM-safe rendering", () => {
    expect(arena).toContain("Autopilot status unavailable; no operational state is claimed.");
    expect(arena).toContain("replaceChildren");
    expect(arena).not.toMatch(/autopilot[^<\n]*\.innerHTML|innerHTML[^<\n]*autopilot/i);
  });

  it("states the VPS observation boundary and defaults-off order gates", () => {
    expect(arena).toContain("Last-observed VPS operator/state gate only");
    expect(arena).toContain("not exchange or order readiness");
    expect(arena).toContain("defaults OFF");
    expect(arena).toContain("every gate is re-checked before any order");
  });
});

describe("landing and status autopilot source contracts", () => {
  const index = readFileSync("public/index.html", "utf8");
  const status = readFileSync("public/status.html", "utf8");

  it("uses the shared parser and same-origin no-store feed on both pages", () => {
    for (const page of [index, status]) {
      expect(page).toContain('from "./autopilot-status.js"');
      expect(page).toContain('fetch("autopilot-status.json", {');
      expect(page).toContain('cache: "no-store"');
    }
  });

  it("hides a stale landing badge and uses the verified completion timestamp", () => {
    expect(index).toContain("if (!freshness.fresh || feed.lastRun === null) return;");
    expect(index).toContain("feed.lastRun.completedAt");
    expect(index).toContain("autopilotBadge.hidden = true");
  });

  it("keeps status absent and stale states explicit without unsafe rendering", () => {
    expect(status).toContain("Sanitized last-observed VPS operator/state gate");
    expect(status).toContain('autopilotStatusBadge.textContent = "unavailable"');
    expect(status).toContain("feed.lastRun.completedAt");
    expect(status).toContain('freshness.fresh ? "fresh" : "last observed"');
    expect(status).not.toMatch(
      /autopilot[^<\n]*\.innerHTML|innerHTML[^<\n]*autopilot/i,
    );
  });
});
