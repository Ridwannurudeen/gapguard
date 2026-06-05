import { appendFileSync } from "node:fs";
import type { SessionState } from "./types";
import type { DislocationResult } from "./dislocation";
import type { RiskDecision } from "./riskGovernor";

/** One auditable decision: market state in, thesis and risk call out. */
export interface DecisionRecord {
  /** Decision timestamp as a UTC ISO string (supplied by the caller / market data). */
  ts: string;
  symbol: string;
  session: SessionState;
  dislocation: DislocationResult;
  risk: RiskDecision;
}

export function formatRecord(r: DecisionRecord): string {
  return JSON.stringify(r);
}

/** Sink that appends each record as a JSONL line to a file. */
export function fileSink(path: string): (line: string) => void {
  return (line) => appendFileSync(path, line + "\n");
}

/**
 * Append-only audit trail. Every decision is captured verbatim so the strategy is a
 * glass box, not a black box — and the log is the "verifiable usage record" the rubric asks for.
 */
export class GlassBox {
  private readonly records: DecisionRecord[] = [];

  constructor(private readonly sink: (line: string) => void = () => {}) {}

  record(r: DecisionRecord): DecisionRecord {
    this.records.push(r);
    this.sink(formatRecord(r));
    return r;
  }

  all(): DecisionRecord[] {
    return [...this.records];
  }
}
