import { appendFileSync } from "node:fs";
import { createHash } from "node:crypto";
import type { SessionState } from "./types";
import type { DislocationResult } from "./dislocation";
import type { RiskDecision } from "./riskGovernor";
import { canonicalJson } from "./canonicalJson";

/** Optional LLM convergence-gate input applied to this decision. */
export interface GateApplied {
  multiplier: number;
  rationale?: string;
}

export interface MarketEvidence {
  tokenPrice: number;
  referencePrice: number;
  proxyReturn?: number;
  proxyConfidence?: number;
  proxyContributors?: number;
  rawProxyReturn?: number;
}

/** One auditable decision before the hash-chain fields are attached. */
export interface DecisionInput {
  /** Decision timestamp as a UTC ISO string (supplied by the caller / market data). */
  ts: string;
  symbol: string;
  session: SessionState;
  market: MarketEvidence;
  dislocation: DislocationResult;
  risk: RiskDecision;
  /** Present when an LLM gate scaled the dislocation confidence. */
  gate?: GateApplied;
}

/** One auditable decision: market state in, thesis and risk call out. */
export interface DecisionRecord extends DecisionInput {
  /** Previous record's SHA-256 hash, or the genesis hash for the first record. */
  prevHash: string;
  /** SHA-256 hash of this decision plus `prevHash`. */
  hash: string;
}

export const GENESIS_HASH = "0".repeat(64);

export function hashDecision(r: DecisionInput & { prevHash: string }): string {
  return createHash("sha256").update(canonicalJson(r)).digest("hex");
}

export function formatRecord(r: DecisionRecord): string {
  return canonicalJson(r);
}

/** Sink that appends each record as a JSONL line to a file. */
export function fileSink(path: string): (line: string) => void {
  return (line) => appendFileSync(path, line + "\n");
}

/**
 * Append-only audit trail. Every decision is captured verbatim so the strategy is a
 * glass box, not a black box; the hash chain makes local simulated records tamper-evident.
 */
export class GlassBox {
  private readonly records: DecisionRecord[] = [];
  private prevHash = GENESIS_HASH;

  constructor(private readonly sink: (line: string) => void = () => {}) {}

  record(r: DecisionInput): DecisionRecord {
    const prevHash = this.prevHash;
    const hash = hashDecision({ ...r, prevHash });
    const record = { ...r, prevHash, hash };
    this.records.push(record);
    this.prevHash = hash;
    this.sink(formatRecord(record));
    return record;
  }

  all(): DecisionRecord[] {
    return [...this.records];
  }
}
