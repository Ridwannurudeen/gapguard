import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { GENESIS_HASH, hashDecision, type DecisionInput } from "./glassbox";
import {
  parseJsonlRecords,
  verifyRecords,
  type ChainRecord,
  type LogVerification,
} from "./logVerifier";

export type ArenaRecordKind =
  | "mandate_rule"
  | "quorum_decision"
  | "agent_decision"
  | "mandate_breach"
  | "passport_issued"
  | "broker_order";

export interface ArenaRecordInput {
  ts: string;
  kind: ArenaRecordKind;
  agentId: string;
  payload: unknown;
}

export interface ArenaRecord extends ArenaRecordInput, ChainRecord {
  prevHash: string;
  hash: string;
}

function recordHash(input: ArenaRecordInput, prevHash: string): string {
  return hashDecision({
    ...input,
    prevHash,
  } as unknown as DecisionInput & { prevHash: string });
}

export function sealArenaRecords(inputs: ArenaRecordInput[]): ArenaRecord[] {
  let prevHash = GENESIS_HASH;
  return inputs.map((input) => {
    const hash = recordHash(input, prevHash);
    const record = { ...input, prevHash, hash };
    prevHash = hash;
    return record;
  });
}

export function formatArenaChain(records: ArenaRecord[]): string {
  return `${records.map((record) => JSON.stringify(record)).join("\n")}\n`;
}

export function verifyArenaRecords(records: ArenaRecord[]): LogVerification {
  return verifyRecords(records);
}

export function readArenaChain(path: string): ArenaRecord[] {
  return parseJsonlRecords(readFileSync(path, "utf8")) as ArenaRecord[];
}

export function writeArenaChain(path: string, records: ArenaRecord[]): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, formatArenaChain(records));
}
