export const GENESIS_HASH = "0".repeat(64);

const ARENA_KINDS = new Set([
  "mandate_rule",
  "quorum_decision",
  "agent_decision",
  "mandate_breach",
  "passport_issued",
  "broker_order",
  "reflection",
]);

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function canonicalJson(value) {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("canonical JSON cannot encode non-finite numbers");
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .filter((key) => value[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  throw new Error(`canonical JSON cannot encode ${typeof value}`);
}

async function sha256Hex(value) {
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function failure(error) {
  return error instanceof Error ? error.message : String(error);
}

export function parseArenaJsonl(raw) {
  if (typeof raw !== "string") {
    throw new TypeError("Arena JSONL must be a string");
  }
  return raw
    .split(/\r?\n/)
    .map((line, index) => ({ line: line.trim(), row: index + 1 }))
    .filter(({ line }) => line.length > 0)
    .map(({ line, row }) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`arena-chain.jsonl line ${row} is invalid JSON: ${failure(error)}`);
      }
    });
}

export async function verifyArenaChain(records) {
  const errors = [];
  const brokenRows = new Set();
  let expectedPrev = GENESIS_HASH;
  let finalHash = GENESIS_HASH;

  if (!Array.isArray(records) || records.length === 0) {
    return {
      ok: false,
      count: Array.isArray(records) ? records.length : 0,
      finalHash,
      errors: [
        Array.isArray(records)
          ? "arena-chain.jsonl is empty"
          : "arena-chain.jsonl must contain an array of records",
      ],
      brokenRows: [],
    };
  }

  for (const [index, value] of records.entries()) {
    const row = index + 1;
    if (!isRecord(value)) {
      errors.push(`line ${row}: record malformed`);
      brokenRows.add(row);
      continue;
    }
    const record = value;
    const prevHashOk =
      typeof record.prevHash === "string" && /^[a-f0-9]{64}$/.test(record.prevHash);
    const hashOk =
      typeof record.hash === "string" && /^[a-f0-9]{64}$/.test(record.hash);
    if (!prevHashOk) {
      errors.push(`line ${row}: prevHash malformed`);
      brokenRows.add(row);
    }
    if (!hashOk) {
      errors.push(`line ${row}: hash malformed`);
      brokenRows.add(row);
    }
    if (typeof record.ts !== "string" || record.ts.length === 0) {
      errors.push(`line ${row}: ts missing`);
      brokenRows.add(row);
    }
    if (!ARENA_KINDS.has(record.kind)) {
      errors.push(`line ${row}: kind malformed`);
      brokenRows.add(row);
    }
    if (typeof record.agentId !== "string" || record.agentId.length === 0) {
      errors.push(`line ${row}: agentId missing`);
      brokenRows.add(row);
    }
    if (!Object.prototype.hasOwnProperty.call(record, "payload")) {
      errors.push(`line ${row}: payload missing`);
      brokenRows.add(row);
    }
    if (record.prevHash !== expectedPrev) {
      errors.push(`line ${row}: prevHash mismatch`);
      brokenRows.add(row);
    }

    try {
      const hashInput = { ...record };
      delete hashInput.hash;
      const expectedHash = await sha256Hex(canonicalJson(hashInput));
      if (record.hash !== expectedHash) {
        errors.push(`line ${row}: hash mismatch`);
        brokenRows.add(row);
      }
    } catch (error) {
      errors.push(`line ${row}: hash input invalid (${failure(error)})`);
      brokenRows.add(row);
    }

    if (hashOk) {
      expectedPrev = record.hash;
      finalHash = record.hash;
    }
  }

  return {
    ok: errors.length === 0,
    count: records.length,
    finalHash,
    errors,
    brokenRows: [...brokenRows],
  };
}

function arenaHashInput(record) {
  return {
    ts: record.ts,
    kind: record.kind,
    agentId: record.agentId,
    payload: record.payload,
    prevHash: record.prevHash,
  };
}

export async function computeMerkleRoot(records) {
  if (!Array.isArray(records)) {
    throw new TypeError("Arena records must be an array");
  }
  if (records.length === 0) return GENESIS_HASH;
  let layer = await Promise.all(
    records.map((record) => sha256Hex(canonicalJson(arenaHashInput(record)))),
  );
  while (layer.length > 1) {
    const next = [];
    for (let index = 0; index < layer.length; index += 2) {
      const left = layer[index];
      const right = layer[index + 1] ?? left;
      next.push(await sha256Hex(left + right));
    }
    layer = next;
  }
  return layer[0];
}

function publicKeyBody(pem) {
  if (typeof pem !== "string") {
    throw new TypeError("Arena public key must be PEM text");
  }
  const match = pem.match(
    /^-----BEGIN PUBLIC KEY-----\s+([A-Za-z0-9+/=\s]+?)\s+-----END PUBLIC KEY-----\s*$/,
  );
  if (!match) throw new Error("Arena public key PEM is malformed");
  return match[1].replace(/\s+/g, "");
}

function base64Bytes(value, path) {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${path} must be non-empty base64`);
  }
  try {
    return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
  } catch {
    throw new Error(`${path} is malformed base64`);
  }
}

function parseAttestation(value) {
  if (!isRecord(value)) throw new TypeError("Arena attestation must be an object");
  const allowed = new Set([
    "alg",
    "merkleRoot",
    "recordCount",
    "signedAt",
    "model",
    "publicKeySpkiB64",
    "signatureB64",
  ]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`Arena attestation has unexpected field ${key}`);
  }
  if (value.alg !== "Ed25519") throw new Error("Arena attestation alg must be Ed25519");
  if (typeof value.merkleRoot !== "string" || !/^[a-f0-9]{64}$/.test(value.merkleRoot)) {
    throw new Error("Arena attestation merkleRoot is malformed");
  }
  if (!Number.isSafeInteger(value.recordCount) || value.recordCount < 0) {
    throw new Error("Arena attestation recordCount is invalid");
  }
  if (
    typeof value.signedAt !== "string" ||
    !Number.isFinite(Date.parse(value.signedAt)) ||
    new Date(value.signedAt).toISOString() !== value.signedAt
  ) {
    throw new Error("Arena attestation signedAt is invalid");
  }
  if (value.model !== undefined && (typeof value.model !== "string" || value.model.length === 0)) {
    throw new Error("Arena attestation model is invalid");
  }
  base64Bytes(value.publicKeySpkiB64, "Arena attestation public key");
  base64Bytes(value.signatureB64, "Arena attestation signature");
  return {
    alg: value.alg,
    merkleRoot: value.merkleRoot,
    recordCount: value.recordCount,
    signedAt: value.signedAt,
    ...(value.model ? { model: value.model } : {}),
    publicKeySpkiB64: value.publicKeySpkiB64,
    signatureB64: value.signatureB64,
  };
}

export async function verifyArenaAttestation(records, value, publicKeyPem) {
  const result = {
    ok: false,
    merkleRootOk: false,
    signatureOk: false,
    publicKeyOk: false,
    recordCountOk: false,
    error: "",
  };
  try {
    const attestation = parseAttestation(value);
    const publishedPublicKey = publicKeyBody(publicKeyPem);
    result.merkleRootOk =
      (await computeMerkleRoot(records)) === attestation.merkleRoot;
    result.recordCountOk = attestation.recordCount === records.length;
    result.publicKeyOk = publishedPublicKey === attestation.publicKeySpkiB64;
    const signedEnvelope = {
      alg: attestation.alg,
      merkleRoot: attestation.merkleRoot,
      recordCount: attestation.recordCount,
      signedAt: attestation.signedAt,
      ...(attestation.model ? { model: attestation.model } : {}),
      publicKeySpkiB64: attestation.publicKeySpkiB64,
    };
    const key = await globalThis.crypto.subtle.importKey(
      "spki",
      base64Bytes(publishedPublicKey, "Arena published public key"),
      { name: "Ed25519" },
      false,
      ["verify"],
    );
    result.signatureOk = await globalThis.crypto.subtle.verify(
      { name: "Ed25519" },
      key,
      base64Bytes(attestation.signatureB64, "Arena attestation signature"),
      new TextEncoder().encode(canonicalJson(signedEnvelope)),
    );
    result.ok =
      result.merkleRootOk &&
      result.signatureOk &&
      result.publicKeyOk &&
      result.recordCountOk;
  } catch (error) {
    result.error = failure(error);
  }
  return result;
}

export function verifyPublishedArenaBinding(data, records, chainResult) {
  const result = {
    ok: false,
    decisionMatchOk: false,
    instrumentOk: false,
    recordCountOk: false,
    finalHashOk: false,
    decision: null,
    error: "",
  };
  try {
    if (!isRecord(data) || !isRecord(data.arena) || !isRecord(data.arenaChain)) {
      throw new Error("arena-data.json is missing Arena metadata");
    }
    if (!Array.isArray(records) || !isRecord(chainResult)) {
      throw new Error("Arena proof records are unavailable");
    }
    const quorumRecord = [...records]
      .reverse()
      .find((record) => isRecord(record) && record.kind === "quorum_decision");
    const decision = isRecord(quorumRecord?.payload)
      ? quorumRecord.payload.decision
      : null;
    if (!isRecord(decision) || !isRecord(data.quorum)) {
      throw new Error("signed Quorum decision is unavailable");
    }
    result.decision = decision;
    result.decisionMatchOk = canonicalJson(data.quorum) === canonicalJson(decision);
    result.instrumentOk =
      typeof decision.symbol === "string" &&
      data.arena.liveInstrument === decision.symbol;
    result.recordCountOk =
      Number.isSafeInteger(data.arenaChain.count) &&
      data.arenaChain.count === chainResult.count;
    result.finalHashOk =
      typeof data.arenaChain.finalHash === "string" &&
      data.arenaChain.finalHash === chainResult.finalHash;
    result.ok =
      chainResult.ok === true &&
      result.decisionMatchOk &&
      result.instrumentOk &&
      result.recordCountOk &&
      result.finalHashOk;
  } catch (error) {
    result.error = failure(error);
  }
  return result;
}
