import { appendFileSync } from "node:fs";
import { createHash } from "node:crypto";
import type { SessionState } from "./types";
import type { DislocationResult } from "./dislocation";
import type { RiskDecision } from "./riskGovernor";

/** Optional LLM convergence-gate input applied to this decision. */
export interface GateApplied {
  multiplier: number;
  rationale?: string;
}

/** One auditable decision: market state in, thesis and risk call out. */
export interface DecisionRecord {
  /** Decision timestamp as a UTC ISO string (supplied by the caller / market data). */
  ts: string;
  symbol: string;
  session: SessionState;
  dislocation: DislocationResult;
  risk: RiskDecision;
  /** Present when an LLM gate scaled the dislocation confidence. */
  gate?: GateApplied;
}

/** A decision sealed into the hash chain: the payload plus its link to the prior record. */
export interface SealedRecord extends DecisionRecord {
  /** Hash of the previous record's payload chain (`GENESIS` for the first record). */
  prevHash: string;
  /** sha256 over this record's canonical payload concatenated with `prevHash`. */
  recordHash: string;
}

/** Null hash that anchors the chain before the first record. */
export const GENESIS = "0".repeat(64);

/** Deterministic serialization of the decision payload only (never the chain hashes). */
function canonicalPayload(r: DecisionRecord): string {
  const { ts, symbol, session, dislocation, risk, gate } = r;
  return JSON.stringify(
    gate
      ? { ts, symbol, session, dislocation, risk, gate }
      : { ts, symbol, session, dislocation, risk },
  );
}

function hashRecord(r: DecisionRecord, prevHash: string): string {
  return createHash("sha256")
    .update(canonicalPayload(r) + prevHash)
    .digest("hex");
}

export function formatRecord(r: DecisionRecord): string {
  return JSON.stringify(r);
}

/** Sink that appends each record as a JSONL line to a file. */
export function fileSink(path: string): (line: string) => void {
  return (line) => appendFileSync(path, line + "\n");
}

/**
 * Append-only audit trail. Every decision is captured verbatim and chained by sha256
 * (`recordHash` over the payload + the prior `recordHash`), so the log is not just a glass
 * box but a tamper-evident one: altering any past record breaks `verifyChain()`.
 */
export class GlassBox {
  private readonly records: SealedRecord[] = [];

  constructor(private readonly sink: (line: string) => void = () => {}) {}

  record(r: DecisionRecord): SealedRecord {
    const prevHash = this.records.length
      ? this.records[this.records.length - 1].recordHash
      : GENESIS;
    const sealed: SealedRecord = {
      ...r,
      prevHash,
      recordHash: hashRecord(r, prevHash),
    };
    this.records.push(sealed);
    this.sink(formatRecord(sealed));
    return sealed;
  }

  all(): SealedRecord[] {
    return [...this.records];
  }

  /** Recompute the chain and confirm every link is intact — false if any record was altered. */
  verifyChain(): boolean {
    let prevHash = GENESIS;
    for (const r of this.records) {
      if (r.prevHash !== prevHash || r.recordHash !== hashRecord(r, prevHash))
        return false;
      prevHash = r.recordHash;
    }
    return true;
  }
}
