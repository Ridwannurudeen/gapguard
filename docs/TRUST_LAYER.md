# GapGuard Trust Layer — a portable attestation format for trading agents

Most "AI trading agent" projects ask you to trust a screenshot. GapGuard's
decisions are sealed into a tamper-evident, signed ledger that **anyone can
re-verify in a browser without trusting us**. That ledger is not GapGuard-specific
— it is a small, self-contained attestation format any trading (or non-trading)
agent can adopt. This doc specifies it so it can be lifted out and reused.

> **Boundary.** This is a *cryptographic integrity* proof — it proves a decision
> log was produced by a specific key and has not been altered since. It is **not**
> a regulatory certification and makes no claim about the quality of the decisions.

## Why it's a cross-cutting primitive, not a feature

Alpha claims are contested; integrity claims are not. Whatever an agent decides —
a trade, a risk veto, a governance vote, a moderation call — the same three
questions apply: *did this agent really produce this record, in this order, and
has anyone edited it since?* A portable seal → Merkle → sign → browser-verify
chain answers all three for any agent, in any track, with ~200 lines of
dependency-free code and no server to trust at verification time.

## The format

### 1. Record

Each decision is one JSONL line (`public/arena-chain.jsonl`):

```json
{ "ts": "...", "kind": "quorum_decision", "agentId": "...", "payload": { ... },
  "prevHash": "<hex>", "hash": "<hex>" }
```

`kind` is an open enum (`quorum_decision`, `mandate_breach`, `broker_order`,
`reflection`, …). `payload` is arbitrary — the format is agnostic to what the
agent does.

### 2. Per-record hash + chain linkage

```
hash = sha256( canonicalJson({ ts, kind, agentId, payload, prevHash }) )
```

- `canonicalJson` (`src/canonicalJson.ts`) is deterministic: object keys sorted,
  `undefined` dropped, standard JSON number/string encoding. This determinism is
  the whole game — it is what lets Node and a browser compute **byte-identical**
  input to the hash.
- The first record's `prevHash` is `GENESIS_HASH` (64 zeros); each subsequent
  `prevHash` is the previous record's `hash`. Editing any record breaks its own
  hash and every hash after it. (`sealArenaRecords`, `src/arena-chain.ts:49`.)

### 3. Merkle root + Ed25519 attestation

The chain already makes any single edit detectable. The attestation
(`public/arena-attestation.json`) adds a compact fingerprint of the whole ledger,
signed for attribution / non-repudiation:

```json
{ "alg": "Ed25519", "merkleRoot": "<hex>", "recordCount": N, "signedAt": "...",
  "model": "...", "publicKeySpkiB64": "<der-spki>", "signatureB64": "<sig>" }
```

- `merkleRoot` = a binary Merkle tree over the per-record hashes; on an odd layer
  the last node is duplicated (`computeMerkleRoot`, `arena-chain.ts:149`).
- The signature is Ed25519 over `canonicalJson` of the envelope **without** the
  signature field. The signer's SPKI public key is embedded, so verification
  needs nothing external. (`attestChain`, `arena-chain.ts:166`.)

### 4. Verification (`verifyAttestation`, `arena-chain.ts:196`)

A verifier, given only the records + attestation, checks all of:

| Check | Meaning |
| --- | --- |
| `chainOk` | every `prevHash`/`hash` links (no row edited or reordered) |
| `merkleRootOk` | recomputed root equals the signed root |
| `recordCountOk` | count matches (no rows appended/dropped post-signing) |
| `signatureOk` | Ed25519 signature valid over the canonical envelope |
| `publicKeyOk` | embedded key matches the expected key, if one is pinned |

### 5. Browser parity — "verify, don't trust"

The judge cockpit (`public/arena.html`) re-runs the **same** computation client-side
with SubtleCrypto: it re-canonicalizes each record, re-hashes with `sha256`,
re-links the chain, and re-checks the signature. Because the browser's
`canonicalJson` byte-matches `src/canonicalJson.ts`, the hashes match exactly.
Flip one byte in any record and the badge turns red on the exact row. No server,
no API, no trust in the operator. The "Simulate tampering" toggle demonstrates it
live.

## Integrate it into another agent

1. Emit each decision as an `ArenaRecordInput` (`{ ts, kind, agentId, payload }`)
   and call `sealArenaRecords(inputs)` → hash-chained records.
2. `writeArenaChain(path, records)` to persist JSONL; `attestChain(records, {
   signedAt, model, privateKey })` for the signed root. Keep the private key
   server-side; publish only the chain + attestation + SPKI public key.
3. Ship the ~120-line browser verifier (see `arena.html`) so consumers verify
   without a backend.
4. Anyone runs `npm run verify-log -- <chain.jsonl>` (`src/verify-log.ts`) or the
   in-browser check to confirm integrity.

Dependencies: Node `crypto` (or WebCrypto in the browser) and the standalone
`canonicalJson`. No chain, no gas, no external service.

## Files

- `src/arena-chain.ts` — seal, Merkle root, attest, verify.
- `src/canonicalJson.ts` — deterministic serialization (node↔browser parity).
- `src/glassbox.ts` — `hashDecision`, `GENESIS_HASH`.
- `src/logVerifier.ts` — chain-linkage verification.
- `src/arenaSigning.ts` — key loading + SPKI export.
- `public/arena.html` — in-browser SubtleCrypto verifier + tamper demo.
- `public/arena-chain.jsonl`, `public/arena-attestation.json`, `public/arena-pubkey.pem` — the public evidence.
