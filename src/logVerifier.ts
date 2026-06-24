import { readFileSync } from "node:fs";
import { GENESIS_HASH, hashDecision, type DecisionInput } from "./glassbox";

export interface LogVerification {
  ok: boolean;
  count: number;
  finalHash: string;
  errors: string[];
}

export interface ChainRecord {
  prevHash: string;
  hash: string;
}

export type ChainRecordValidator = (
  record: ChainRecord,
  row: number,
) => string[];

const HEX_64 = /^[a-f0-9]{64}$/;

function stripHashFields(record: ChainRecord): Record<string, unknown> {
  const input: Record<string, unknown> = {
    ...(record as unknown as Record<string, unknown>),
  };
  delete input.hash;
  delete input.prevHash;
  return input;
}

export function parseJsonlRecords(raw: string): ChainRecord[] {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as ChainRecord);
}

function validateHashFields(record: ChainRecord, row: number): string[] {
  const errors: string[] = [];
  if (typeof record.prevHash !== "string" || !HEX_64.test(record.prevHash)) {
    errors.push(`line ${row}: prevHash must be a 64-char lowercase hex string`);
  }
  if (typeof record.hash !== "string" || !HEX_64.test(record.hash)) {
    errors.push(`line ${row}: hash must be a 64-char lowercase hex string`);
  }
  return errors;
}

export function verifyRecords(
  records: ChainRecord[],
  validateRecord: ChainRecordValidator = () => [],
): LogVerification {
  const errors: string[] = [];
  let expectedPrev = GENESIS_HASH;
  let finalHash = GENESIS_HASH;

  if (records.length === 0) {
    errors.push("hash chain is empty");
  }

  records.forEach((record, index) => {
    const row = index + 1;
    errors.push(...validateHashFields(record, row));
    errors.push(...validateRecord(record, row));

    if (record.prevHash !== expectedPrev) {
      errors.push(
        `line ${row}: prevHash ${record.prevHash} does not match expected ${expectedPrev}`,
      );
    }

    const expectedHash = hashDecision({
      ...stripHashFields(record),
      prevHash: record.prevHash,
    } as DecisionInput & { prevHash: string });
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
