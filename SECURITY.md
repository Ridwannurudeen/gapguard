# Security Policy

## Scope

GapGuard is a hackathon prototype for tokenized-US-stock decision gating. The trusted surfaces are the source code, committed artifacts, `public/arena-pubkey.pem`, and `submission-manifest.json`. The private Arena signing key, Bitget credentials, Finnhub key, and Qwen key are never committed.

## Trust Boundaries

- External model output is untrusted. The Qwen catalyst gate is schema-checked and fails closed.
- News, candle, market, and cached-verdict JSON are untrusted at load time and validated before use.
- Browser verification is an integrity check over committed artifacts, not regulatory certification.
- Demo/paper Bitget records are broker-integration evidence, not live RWA stock fills.

## Abuse Cases

- Prompt injection in headlines: news is wrapped as untrusted data before model calls.
- Artifact tampering: Arena and replay records are hash-chained and signed by the published public key.
- Credential leakage: keys must stay in environment variables or ignored local files only.
- Overclaiming evidence: public copy must distinguish simulated, paper, cached-Qwen, and backtest evidence.

## Operator Console (write plane)

The public site is read-only. The order-placing path is the operator console (`src/operatorConsole.ts`, `npm run operator`), held separate under these controls:

- Loopback only: the console binds `127.0.0.1` and is never exposed publicly. Its HTML is inline in source and is excluded from the deployed `public/` bundle.
- Keys stay server-side: `BITGET_*` credentials live in the server's environment and are never sent to or held by the browser page.
- Token-authenticated: requests require an `OPERATOR_TOKEN` (>= 8 chars) the operator sets; a missing or wrong token is rejected with HTTP 401.
- Gates enforced server-side, not in the UI: `dry_run` only builds a plan; `paper` routes to Bitget Demo; `live` requires a LICENSED passport, explicit confirmation, isolated margin, <= 2x leverage, and a notional cap (`src/liveStockBroker.ts`). The page cannot bypass any gate.
- Auditable and idempotent: each action carries a `clientOid` and is recorded for the signed audit trail.

## Reporting

Report security issues privately to the repository owner before public disclosure. Do not include secrets in issues, PRs, screenshots, or logs.
