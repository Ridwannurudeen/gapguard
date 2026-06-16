import { readFileSync } from "node:fs";
import {
  GENESIS_HASH,
  hashDecision,
  type DecisionInput,
  type DecisionRecord,
} from "./glassbox";

export interface LogVerification {
  ok: boolean;
  count: number;
  finalHash: string;
  errors: string[];
}

function stripHashFields(record: DecisionRecord): DecisionInput {
  const input: Partial<DecisionRecord> = { ...record };
  delete input.hash;
  delete input.prevHash;
  return input as DecisionInput;
}

export function parseJsonlRecords(raw: string): DecisionRecord[] {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as DecisionRecord);
}

export function verifyRecords(records: DecisionRecord[]): LogVerification {
  const errors: string[] = [];
  let expectedPrev = GENESIS_HASH;
  let finalHash = GENESIS_HASH;

  records.forEach((record, index) => {
    const row = index + 1;
    if (record.prevHash !== expectedPrev) {
      errors.push(
        `line ${row}: prevHash ${record.prevHash} does not match expected ${expectedPrev}`,
      );
    }

    const expectedHash = hashDecision({
      ...stripHashFields(record),
      prevHash: record.prevHash,
    });
    if (record.hash !== expectedHash) {
      errors.push(
        `line ${row}: hash ${record.hash} does not match expected ${expectedHash}`,
      );
    }

    expectedPrev = record.hash;
    finalHash = record.hash;
  });

  return {
    ok: errors.length === 0,
    count: records.length,
    finalHash,
    errors,
  };
}

export function verifyJsonl(raw: string): LogVerification {
  return verifyRecords(parseJsonlRecords(raw));
}

export function verifyJsonlFile(path: string): LogVerification {
  return verifyJsonl(readFileSync(path, "utf8"));
}
