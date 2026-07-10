import { generateKeyPairSync } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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
  appendAutoTraderEvidence,
  buildReconciledOrderEvidence,
  prepareLiveAutoTraderEvidence,
  replayPendingOrderEvidence,
  validateAutoTraderEvidenceRow,
  type AutoTraderEvidenceStatus,
} from "../src/autoTraderEvidence";
import {
  markPendingOrderTerminal,
  reservePendingOrder,
  stagePendingOrderEvidence,
  updatePendingOrder,
  type AutoTraderDailyState,
} from "../src/autoTraderState";

const STATE: AutoTraderDailyState = {
  date: "2026-07-11",
  tradesOpened: 0,
  realizedPnlUSDT: 0,
  killSwitchTripped: false,
  killSwitchReason: null,
  pendingOrder: null,
};

function liveFixture() {
  const dir = mkdtempSync(join(tmpdir(), "gapguard-auto-evidence-"));
  const chainPath = join(dir, "arena-chain.jsonl");
  const attestationPath = join(dir, "arena-attestation.json");
  const publicKeyPath = join(dir, "arena-pubkey.pem");
  const privateKeyPath = join(dir, "arena-private.pem");
  const pair = generateKeyPairSync("ed25519");
  const records = sealArenaRecords([
    {
      ts: "2026-07-10T00:00:00.000Z",
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
        signedAt: "2026-07-10T00:00:00.000Z",
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
  return {
    dir,
    pair,
    attestedArena: {
      chainPath,
      attestationPath,
      publicKeyPath,
      lockPath: join(dir, "arena-chain.lock"),
      env: { ARENA_SIGNING_KEY_FILE: privateKeyPath },
      model: "GapGuard autonomous test",
    },
  };
}

describe("auto-trader evidence journal", () => {
  it("journals a dry-run row without creating or touching an Arena chain", () => {
    const dir = mkdtempSync(join(tmpdir(), "gapguard-auto-dry-evidence-"));
    const journalPath = join(dir, "live-trades.jsonl");
    const result = appendAutoTraderEvidence(
      {
        ts: "2026-07-11T00:00:00.000Z",
        trigger: "auto",
        mode: "dry_run",
        status: "dry_run",
        symbol: "NVDAUSDT",
      },
      { journalPath },
    );

    expect(result.chainAppended).toBe(false);
    expect(JSON.parse(readFileSync(journalPath, "utf8"))).toEqual(result.row);
    expect(existsSync(join(dir, "arena-chain.jsonl"))).toBe(false);
  });

  it.each<AutoTraderEvidenceStatus>([
    "submitted",
    "timeout",
    "cancelled",
    "error",
  ])("does not hide a live %s outcome from the journal or chain", (status) => {
    const fixture = liveFixture();
    const journalPath = join(fixture.dir, "live-trades.jsonl");
    const row = {
      ts: "2026-07-11T00:00:00.000Z",
      trigger: "auto" as const,
      mode: "live" as const,
      status,
      symbol: "NVDAUSDT",
      clientOid: `gg-auto-${status}`,
    };
    const result = appendAutoTraderEvidence(row, {
      journalPath,
      attestedArena: fixture.attestedArena,
    });
    const chain = readArenaChain(fixture.attestedArena.chainPath);
    const attestation = JSON.parse(
      readFileSync(fixture.attestedArena.attestationPath, "utf8"),
    );

    expect(result.chainAppended).toBe(true);
    expect(JSON.parse(readFileSync(journalPath, "utf8"))).toEqual(row);
    expect(chain.at(-1)).toMatchObject({
      kind: "broker_order",
      payload: row,
    });
    expect(
      verifyAttestation(chain, attestation, {
        publicKey: fixture.pair.publicKey,
      }).ok,
    ).toBe(true);
  });

  it("rejects non-canonical timestamps and inconsistent mode/status pairs", () => {
    expect(() =>
      validateAutoTraderEvidenceRow({
        ts: "2026-07-11",
        trigger: "auto",
        mode: "dry_run",
        status: "dry_run",
      }),
    ).toThrow("canonical ISO timestamp");
    expect(() =>
      validateAutoTraderEvidenceRow({
        ts: "2026-07-11T00:00:00.000Z",
        trigger: "auto",
        mode: "live",
        status: "dry_run",
      }),
    ).toThrow("live evidence status");
  });

  it.each(["open", "buy_single", "sell_single"] as const)(
    "builds deterministic terminal-reconciliation evidence for %s from the durable reservation",
    (tradeSide) => {
      const pending = markPendingOrderTerminal(
        reservePendingOrder(STATE, {
          clientOid: "ggauto-reconciled",
          symbol: "NVDAUSDT",
          reservedAt: "2026-07-11T00:00:00.000Z",
        }),
        "ggauto-reconciled",
        { status: "filled", orderId: "bitget-order-reconciled" },
      ).pendingOrder;
      if (!pending) throw new Error("expected pending terminal order");
      const exchangeOrder = {
        orderId: "bitget-order-reconciled",
        clientOid: "ggauto-reconciled",
        symbol: "NVDAUSDT",
        status: "filled",
        tradeSide,
        createdAt: Date.parse("2026-07-11T00:00:01.000Z"),
      };

      const first = buildReconciledOrderEvidence(pending, exchangeOrder);
      const retry = buildReconciledOrderEvidence(pending, exchangeOrder);

      expect(first).toEqual(retry);
      expect(first).toMatchObject({
        ts: "2026-07-11T00:00:01.000Z",
        trigger: "auto",
        mode: "live",
        status: "filled",
        reconciliation: "exchange_history",
        symbol: "NVDAUSDT",
        clientOid: "ggauto-reconciled",
        orderId: "bitget-order-reconciled",
      });
      expect(first.eventId).toMatch(/^ggauto-reconcile-[a-f0-9]{64}$/);
    },
  );

  it("repairs a journal-only reconciliation event and remains idempotent on retry", () => {
    const fixture = liveFixture();
    const journalPath = join(fixture.dir, "live-trades.jsonl");
    const pending = markPendingOrderTerminal(
      reservePendingOrder(STATE, {
        clientOid: "ggauto-journal-only",
        symbol: "NVDAUSDT",
        reservedAt: "2026-07-11T00:00:00.000Z",
      }),
      "ggauto-journal-only",
      { status: "cancelled", orderId: "bitget-order-cancelled" },
    ).pendingOrder;
    if (!pending) throw new Error("expected pending terminal order");
    const row = buildReconciledOrderEvidence(pending, {
      orderId: "bitget-order-cancelled",
      clientOid: "ggauto-journal-only",
      symbol: "NVDAUSDT",
      status: "canceled",
      tradeSide: "open",
      createdAt: Date.parse("2026-07-11T00:00:01.000Z"),
    });
    writeFileSync(
      journalPath,
      `${JSON.stringify({ mode: "live", clientOid: "manual-order" })}\n${JSON.stringify(row)}\n`,
    );

    const repaired = appendAutoTraderEvidence(row, {
      journalPath,
      attestedArena: fixture.attestedArena,
    });
    const retried = appendAutoTraderEvidence(row, {
      journalPath,
      attestedArena: fixture.attestedArena,
    });
    const journal = readFileSync(journalPath, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    const chain = readArenaChain(fixture.attestedArena.chainPath);

    expect(repaired).toMatchObject({
      journalAppended: false,
      chainAppended: true,
    });
    expect(retried).toMatchObject({
      journalAppended: false,
      chainAppended: false,
    });
    expect(
      journal.filter((entry) => entry.eventId === row.eventId),
    ).toHaveLength(1);
    expect(
      chain.filter(
        (record) =>
          record.kind === "broker_order" &&
          (record.payload as { eventId?: string }).eventId === row.eventId,
      ),
    ).toHaveLength(1);
  });

  it("fails closed when an event ID is reused for different evidence", () => {
    const fixture = liveFixture();
    const journalPath = join(fixture.dir, "live-trades.jsonl");
    const row = {
      ts: "2026-07-11T00:00:01.000Z",
      trigger: "auto" as const,
      mode: "live" as const,
      status: "filled" as const,
      eventId: "ggauto-reconcile-conflict",
      symbol: "NVDAUSDT",
    };
    appendAutoTraderEvidence(row, {
      journalPath,
      attestedArena: fixture.attestedArena,
    });

    expect(() =>
      appendAutoTraderEvidence(
        { ...row, symbol: "AAPLUSDT" },
        { journalPath, attestedArena: fixture.attestedArena },
      ),
    ).toThrow("conflicting evidence eventId");
    expect(readFileSync(journalPath, "utf8").trim().split("\n")).toHaveLength(
      1,
    );
  });

  it("assigns ordinary live outcomes a deterministic content-bound event ID", () => {
    const input = {
      ts: "2026-07-11T00:00:01.000Z",
      trigger: "auto" as const,
      mode: "live" as const,
      status: "filled" as const,
      symbol: "NVDAUSDT",
      clientOid: "ggauto-ordinary-filled",
      orderId: "bitget-order-ordinary-filled",
      result: {
        status: "filled",
        receipt: { orderId: "bitget-order-ordinary-filled" },
      },
    };

    const first = prepareLiveAutoTraderEvidence(input);
    const retry = prepareLiveAutoTraderEvidence(input);

    expect(first).toEqual(retry);
    expect(first.eventId).toMatch(/^ggauto-outcome-[a-f0-9]{64}$/);
    expect(prepareLiveAutoTraderEvidence(first)).toEqual(first);
  });

  it.each(["filled", "cancelled"] as const)(
    "repairs a journal-only ordinary %s outcome before clearing its reservation",
    (status) => {
      const fixture = liveFixture();
      const journalPath = join(fixture.dir, "live-trades.jsonl");
      const orderId = `bitget-order-ordinary-${status}`;
      const row = prepareLiveAutoTraderEvidence({
        ts: "2026-07-11T00:00:01.000Z",
        trigger: "auto",
        mode: "live",
        status,
        symbol: "NVDAUSDT",
        clientOid: `ggauto-ordinary-${status}`,
        orderId,
        result: { status, receipt: { orderId } },
      });
      const terminal = markPendingOrderTerminal(
        reservePendingOrder(STATE, {
          clientOid: `ggauto-ordinary-${status}`,
          symbol: "NVDAUSDT",
          reservedAt: "2026-07-11T00:00:00.000Z",
        }),
        `ggauto-ordinary-${status}`,
        { status, orderId },
      );
      const staged = stagePendingOrderEvidence(
        terminal,
        `ggauto-ordinary-${status}`,
        row,
      );

      expect(() => replayPendingOrderEvidence(staged, { journalPath })).toThrow(
        "attested Arena config",
      );
      expect(staged.pendingOrder?.evidence).toEqual(row);

      const repaired = replayPendingOrderEvidence(staged, {
        journalPath,
        attestedArena: fixture.attestedArena,
      });
      const replayedAfterStateWriteFailure = replayPendingOrderEvidence(
        staged,
        {
          journalPath,
          attestedArena: fixture.attestedArena,
        },
      );
      const journal = readFileSync(journalPath, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      const chain = readArenaChain(fixture.attestedArena.chainPath);

      expect(repaired).toMatchObject({
        journalAppended: false,
        chainAppended: true,
        state: { pendingOrder: null },
      });
      expect(replayedAfterStateWriteFailure).toMatchObject({
        journalAppended: false,
        chainAppended: false,
        state: { pendingOrder: null },
      });
      expect(
        journal.filter((entry) => entry.eventId === row.eventId),
      ).toHaveLength(1);
      expect(
        chain.filter(
          (record) =>
            record.kind === "broker_order" &&
            (record.payload as { eventId?: string }).eventId === row.eventId,
        ),
      ).toHaveLength(1);
    },
  );

  it("repairs error evidence while retaining the ambiguous reservation", () => {
    const fixture = liveFixture();
    const journalPath = join(fixture.dir, "live-trades.jsonl");
    const row = prepareLiveAutoTraderEvidence({
      ts: "2026-07-11T00:00:01.000Z",
      trigger: "auto",
      mode: "live",
      status: "error",
      symbol: "AAPLUSDT",
      clientOid: "ggauto-ordinary-error",
      orderId: null,
      error: "broker result unknown",
    });
    const timedOut = updatePendingOrder(
      reservePendingOrder(STATE, {
        clientOid: "ggauto-ordinary-error",
        symbol: "AAPLUSDT",
        reservedAt: "2026-07-11T00:00:00.000Z",
      }),
      "ggauto-ordinary-error",
      { status: "timeout" },
    );
    const staged = stagePendingOrderEvidence(
      timedOut,
      "ggauto-ordinary-error",
      row,
    );

    expect(() => replayPendingOrderEvidence(staged, { journalPath })).toThrow(
      "attested Arena config",
    );
    const repaired = replayPendingOrderEvidence(staged, {
      journalPath,
      attestedArena: fixture.attestedArena,
    });

    expect(repaired.state.pendingOrder).toMatchObject({
      clientOid: "ggauto-ordinary-error",
      status: "timeout",
    });
    expect(repaired.state.pendingOrder?.evidence).toBeUndefined();
    expect(repaired.journalAppended).toBe(false);
    expect(repaired.chainAppended).toBe(true);
  });
});
