import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import {
  createHash,
  createPublicKey,
  generateKeyPairSync,
  randomUUID,
  sign as edSign,
  verify as edVerify,
  type KeyObject,
} from "node:crypto";
import {
  loadArenaSigningKey,
  publicKeySpkiB64,
  readArenaPublicKey,
} from "./arenaSigning";
import {
  acquireAutoTraderLock,
  releaseAutoTraderLock,
} from "./autoTraderState";
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
  | "broker_order"
  | "reflection";

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
    value === "broker_order" ||
    value === "reflection"
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

function isErrno(error: unknown, code: string): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === code
  );
}

function atomicWriteFile(path: string, contents: string): void {
  const directory = dirname(path);
  mkdirSync(directory, { recursive: true });
  const temporaryPath = join(
    directory,
    `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`,
  );
  let created = false;
  let replaced = false;
  try {
    const fd = openSync(temporaryPath, "wx");
    created = true;
    try {
      writeFileSync(fd, contents, "utf8");
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(temporaryPath, path);
    replaced = true;
    if (process.platform !== "win32") {
      const directoryFd = openSync(directory, "r");
      try {
        fsyncSync(directoryFd);
      } finally {
        closeSync(directoryFd);
      }
    }
  } finally {
    if (created && !replaced) {
      try {
        unlinkSync(temporaryPath);
      } catch (error) {
        if (!isErrno(error, "ENOENT")) throw error;
      }
    }
  }
}

export function writeArenaChain(path: string, records: ArenaRecord[]): void {
  atomicWriteFile(path, formatArenaChain(records));
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

export interface AttestedArenaConfig {
  chainPath: string;
  attestationPath: string;
  publicKeyPath: string;
  lockPath?: string;
  lockMaxAgeMs?: number;
  env?: NodeJS.ProcessEnv;
  model?: string;
}

interface AttestedArenaState {
  records: ArenaRecord[];
  privateKey: KeyObject;
  publicKey: KeyObject;
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

function errorDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function canonicalInstant(value: Date, field: string): string {
  if (!Number.isFinite(value.getTime())) {
    throw new Error(`${field} must be a valid Date`);
  }
  return value.toISOString();
}

function readAttestation(path: string): ArenaAttestation {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("attestation must be an object");
    }
    return parsed as ArenaAttestation;
  } catch (error) {
    throw new Error(`Arena attestation unavailable at ${path}: ${errorDetail(error)}`);
  }
}

function readAttestedArenaState(
  config: AttestedArenaConfig,
  probeSignedAt: string,
): AttestedArenaState {
  let records: ArenaRecord[];
  try {
    records = readArenaChain(config.chainPath);
  } catch (error) {
    throw new Error(
      `Arena chain unavailable at ${config.chainPath}: ${errorDetail(error)}`,
    );
  }
  const chainCheck = verifyArenaRecords(records);
  if (!chainCheck.ok) {
    throw new Error(
      `existing Arena chain verification failed: ${chainCheck.errors.join("; ")}`,
    );
  }

  let publicKey: KeyObject;
  try {
    publicKey = readArenaPublicKey(config.publicKeyPath);
  } catch (error) {
    throw new Error(
      `Arena public key unavailable at ${config.publicKeyPath}: ${errorDetail(error)}`,
    );
  }
  const existingAttestation = readAttestation(config.attestationPath);
  const existingCheck = verifyAttestation(records, existingAttestation, {
    publicKey,
  });
  if (!existingCheck.ok) {
    throw new Error("existing Arena attestation verification failed");
  }

  let privateKey: KeyObject | null;
  try {
    privateKey = loadArenaSigningKey(config.env);
  } catch (error) {
    throw new Error(`Arena signing key is invalid: ${errorDetail(error)}`);
  }
  if (!privateKey) {
    throw new Error(
      "Arena attestation requires ARENA_SIGNING_KEY or .arena-signing-key.pem",
    );
  }
  const probe = attestChain(records, {
    signedAt: probeSignedAt,
    ...(config.model ? { model: config.model } : {}),
    privateKey,
  });
  const probeCheck = verifyAttestation(records, probe, { publicKey });
  if (!probeCheck.ok) {
    throw new Error("Arena signing key does not match published public key");
  }
  return { records, privateKey, publicKey };
}

function withAttestedArenaLock<T>(
  config: AttestedArenaConfig,
  now: Date,
  action: () => T,
): T {
  const lockResult = acquireAutoTraderLock(
    config.lockPath ?? `${config.chainPath}.lock`,
    now,
    config.lockMaxAgeMs ?? 600_000,
  );
  if (!lockResult.acquired) {
    throw new Error(`Arena attested append blocked: ${lockResult.reason}`);
  }
  let actionFailed = false;
  try {
    return action();
  } catch (error) {
    actionFailed = true;
    throw error;
  } finally {
    try {
      const released = releaseAutoTraderLock(lockResult.lock);
      if (!released && !actionFailed) {
        throw new Error("Arena attested append lock ownership changed before release");
      }
    } catch (error) {
      if (!actionFailed) throw error;
    }
  }
}

export function validateAttestedArenaPreflight(
  config: AttestedArenaConfig,
  now: Date = new Date(),
): { recordCount: number; merkleRoot: string } {
  const signedAt = canonicalInstant(now, "attested Arena preflight time");
  return withAttestedArenaLock(config, now, () => {
    const state = readAttestedArenaState(config, signedAt);
    return {
      recordCount: state.records.length,
      merkleRoot: computeMerkleRoot(state.records),
    };
  });
}

function mutateAttestedArenaRecords(
  buildInputs: (existing: ArenaRecord[]) => ArenaRecordInput[],
  config: AttestedArenaConfig,
  lockTime: Date,
  signedAt: string,
): { records: ArenaRecord[]; attestation: ArenaAttestation } {
  return withAttestedArenaLock(config, lockTime, () => {
    const state = readAttestedArenaState(config, signedAt);
    const records = sealArenaRecords(buildInputs([...state.records]));
    const chainCheck = verifyArenaRecords(records);
    if (!chainCheck.ok) {
      throw new Error(
        `updated Arena chain verification failed: ${chainCheck.errors.join("; ")}`,
      );
    }
    const attestation = attestChain(records, {
      signedAt,
      ...(config.model ? { model: config.model } : {}),
      privateKey: state.privateKey,
    });
    const check = verifyAttestation(records, attestation, {
      publicKey: state.publicKey,
    });
    if (!check.ok) {
      throw new Error("updated Arena attestation failed verification");
    }

    writeArenaChain(config.chainPath, records);
    atomicWriteFile(
      config.attestationPath,
      `${JSON.stringify(attestation, null, 2)}\n`,
    );
    const persistedRecords = readArenaChain(config.chainPath);
    const persistedAttestation = readAttestation(config.attestationPath);
    if (
      !verifyAttestation(persistedRecords, persistedAttestation, {
        publicKey: state.publicKey,
      }).ok
    ) {
      throw new Error("persisted Arena chain and attestation failed verification");
    }
    return { records: persistedRecords, attestation: persistedAttestation };
  });
}

export function replaceAttestedArenaRecords(
  buildInputs: (existing: ArenaRecord[]) => ArenaRecordInput[],
  config: AttestedArenaConfig,
  now: Date = new Date(),
): { records: ArenaRecord[]; attestation: ArenaAttestation } {
  const signedAt = canonicalInstant(now, "Arena replacement time");
  return mutateAttestedArenaRecords(
    buildInputs,
    config,
    now,
    signedAt,
  );
}

export function appendAttestedArenaRecord(
  input: ArenaRecordInput,
  config: AttestedArenaConfig,
): { records: ArenaRecord[]; attestation: ArenaAttestation } {
  const signedAt = canonicalInstant(new Date(input.ts), "Arena record ts");
  if (signedAt !== input.ts) {
    throw new Error("Arena record ts must be a canonical ISO timestamp");
  }
  return mutateAttestedArenaRecords(
    (existing) => [...existing.map(stripArenaHashFields), input],
    config,
    new Date(),
    signedAt,
  );
}
