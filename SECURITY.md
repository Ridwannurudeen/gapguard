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

## Reporting

Report security issues privately to the repository owner before public disclosure. Do not include secrets in issues, PRs, screenshots, or logs.
