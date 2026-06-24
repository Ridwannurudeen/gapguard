import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  createHash,
  createPublicKey,
  generateKeyPairSync,
  sign as edSign,
  verify as edVerify,
  type KeyObject,
} from "node:crypto";
import { publicKeySpkiB64 } from "./arenaSigning";
import { GENESIS_HASH, hashDecision, type DecisionInput } from "./glassbox";
import {
  parseJsonlRecords,
  verifyRecords,
  type ChainRecord,
  type LogVerification,
} from "./logVerifier";
import { canonicalJson } from "./canonicalJson";

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
  return `${records.map((record) => canonicalJson(record)).join("\n")}\n`;
}

function isArenaRecordKind(value: unknown): value is ArenaRecordKind {
  return (
    value === "mandate_rule" ||
    value === "quorum_decision" ||
    value === "agent_decision" ||
    value === "mandate_breach" ||
    value === "passport_issued" ||
    value === "broker_order"
  );
}

function validateArenaRecord(record: ChainRecord, row: number): string[] {
  const errors: string[] = [];
  const candidate = record as Partial<ArenaRecord>;
  if (typeof candidate.ts !== "string" || candidate.ts.length === 0) {
    errors.push(`line ${row}: ts is required`);
  }
  if (!isArenaRecordKind(candidate.kind)) {
    errors.push(`line ${row}: kind is not a valid Arena record kind`);
  }
  if (
    typeof candidate.agentId !== "string" ||
    candidate.agentId.length === 0
  ) {
    errors.push(`line ${row}: agentId is required`);
  }
  if (!("payload" in (record as unknown as Record<string, unknown>))) {
    errors.push(`line ${row}: payload is required`);
  }
  return errors;
}

export function verifyArenaRecords(records: ArenaRecord[]): LogVerification {
  return verifyRecords(records, validateArenaRecord);
}

export function readArenaChain(path: string): ArenaRecord[] {
  return parseJsonlRecords(readFileSync(path, "utf8")) as ArenaRecord[];
}

export function writeArenaChain(path: string, records: ArenaRecord[]): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, formatArenaChain(records));
}

// --- Signed Merkle attestation: a root over the chain, signed (Ed25519) ---
// The hash chain already makes any single-row edit detectable; the Merkle root is a
// single compact fingerprint of the whole ledger, and the Ed25519 signature binds it
// to the producer's key (attribution / non-repudiation). Anyone can recompute the
// root from the records and verify the signature against the embedded public key —
// "verify, don't trust": a cryptographic integrity proof, not regulatory certification.

export interface ArenaAttestation {
  alg: "Ed25519";
  merkleRoot: string;
  recordCount: number;
  signedAt: string;
  model?: string;
  publicKeySpkiB64: string;
  signatureB64: string;
}

export interface AttestationVerification {
  ok: boolean;
  merkleRootOk: boolean;
  signatureOk: boolean;
  publicKeyOk: boolean;
  recordCountOk: boolean;
  chainOk: boolean;
}

function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function stripArenaHashFields(record: ArenaRecord): ArenaRecordInput {
  return {
    ts: record.ts,
    kind: record.kind,
    agentId: record.agentId,
    payload: record.payload,
  };
}

/** Merkle root over the per-record hashes (duplicate the last node on odd layers). */
export function computeMerkleRoot(records: ArenaRecord[]): string {
  if (records.length === 0) return GENESIS_HASH;
  let layer = records.map((record) =>
    recordHash(stripArenaHashFields(record), record.prevHash),
  );
  while (layer.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < layer.length; i += 2) {
      const left = layer[i];
      const right = layer[i + 1] ?? left;
      next.push(sha256Hex(left + right));
    }
    layer = next;
  }
  return layer[0];
}

export function attestChain(
  records: ArenaRecord[],
  opts: { signedAt: string; model?: string; privateKey?: KeyObject },
): ArenaAttestation {
  const merkleRoot = computeMerkleRoot(records);
  let privateKey = opts.privateKey;
  let publicKey: KeyObject;
  if (privateKey) {
    publicKey = createPublicKey(privateKey);
  } else {
    const pair = generateKeyPairSync("ed25519");
    privateKey = pair.privateKey;
    publicKey = pair.publicKey;
  }
  const attestation: Omit<ArenaAttestation, "signatureB64"> = {
    alg: "Ed25519",
    merkleRoot,
    recordCount: records.length,
    signedAt: opts.signedAt,
    ...(opts.model ? { model: opts.model } : {}),
    publicKeySpkiB64: publicKeySpkiB64(publicKey),
  };
  const signature = edSign(
    null,
    Buffer.from(canonicalJson(attestation)),
    privateKey,
  );
  return { ...attestation, signatureB64: signature.toString("base64") };
}

export function verifyAttestation(
  records: ArenaRecord[],
  attestation: ArenaAttestation,
  opts: { publicKey?: KeyObject } = {},
): AttestationVerification {
  const merkleRootOk = computeMerkleRoot(records) === attestation.merkleRoot;
  const recordCountOk = attestation.recordCount === records.length;
  const chainOk = verifyArenaRecords(records).ok;
  let signatureOk = false;
  let publicKeyOk = false;
  try {
    const publicKey = createPublicKey({
      key: Buffer.from(attestation.publicKeySpkiB64, "base64"),
      format: "der",
      type: "spki",
    });
    publicKeyOk = opts.publicKey
      ? publicKeySpkiB64(opts.publicKey) === attestation.publicKeySpkiB64
      : true;
    const signedEnvelope = {
      alg: attestation.alg,
      merkleRoot: attestation.merkleRoot,
      recordCount: attestation.recordCount,
      signedAt: attestation.signedAt,
      ...(attestation.model ? { model: attestation.model } : {}),
      publicKeySpkiB64: attestation.publicKeySpkiB64,
    };
    signatureOk = edVerify(
      null,
      Buffer.from(canonicalJson(signedEnvelope)),
      publicKey,
      Buffer.from(attestation.signatureB64, "base64"),
    );
  } catch {
    signatureOk = false;
    publicKeyOk = false;
  }
  return {
    ok: merkleRootOk && signatureOk && publicKeyOk && recordCountOk && chainOk,
    merkleRootOk,
    signatureOk,
    publicKeyOk,
    recordCountOk,
    chainOk,
  };
}
