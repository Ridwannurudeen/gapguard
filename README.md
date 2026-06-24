# GapGuard

GapGuard is an AI abstention and risk engine for tokenized US stocks: it decides whether an off-hours gap is liquidity noise to trade or news-driven repricing to respect, then proves every decision with a signed audit trail.

Bitget AI Base Camp Hackathon S1, Track 3: US Stock AI Trading.

## 60-Second Quickstart

Requires Node.js >=20.

```bash
npm install
npm run judge
```

`npm run judge` rebuilds the stock paper journal, regenerates the Arena cockpit and evidence metrics, verifies `public/arena-chain.jsonl`, runs the readiness audit, serves `public/`, and opens the judge cockpit locally.

Manual checks:

```bash
npm run typecheck
npm test
npm run paper:journal
npm run evidence
npm run evidence:check
npm run verify-log -- public/arena-chain.jsonl
```

## Evidence

All public numbers below are generated from committed artifacts by `npm run evidence`. Full traceability lives in [docs/METRICS.md](docs/METRICS.md) and [public/metrics.json](public/metrics.json).

<!-- EVIDENCE:START -->
| Evidence | Current value | Source |
| --- | ---: | --- |
| AAPLUSDT always-fade baseline | -0.397% / 15 trades | `artifacts/aaplusdt-backtest.json` |
| AAPLUSDT always-follow baseline | -2.955% / 15 trades | `artifacts/aaplusdt-news-aware-backtest.json` |
| AAPLUSDT Qwen gate-driven pilot | +1.418% / 13 trades | `artifacts/aaplusdt-news-aware-backtest.json` |
| 20-symbol RWA always-fade baseline | -0.015% / 747 trades | `artifacts/rwa-multi-backtest.json` |
| Positive pilot OOS over 16 trading days | +2.643% / 116 trades | `artifacts/rwa-alpha-certification.json` |
| Multi-symbol gate holdout | 341 holdout candidates / 20 symbols | `artifacts/gate-holdout-report.json` |
| Stock paper journal | 58 rows | `artifacts/stock-paper-journal.jsonl`, `artifacts/stock-paper-journal.csv` |
| Crypto Demo integration smoke | 3 BTCUSDT paper rows | `artifacts/paper-btc-smoke.jsonl` |
<!-- EVIDENCE:END -->

Boundary: cryptographic integrity proof, not regulatory certification. Approval-gated live path; current stock evidence is backtest/paper. The BTCUSDT Demo fill is a Bitget Demo integration smoke test, not Track 3 stock evidence.

## How It Works

GapGuard is the product. Quorum is the internal five-role deterministic adversarial desk. Agent Passport/Arena is the trust and execution control layer.

1. Perception: Bitget RWA contract/ticker data plus deterministic US-session clock and dislocation logic.
2. Catalyst gate: Qwen classifies real, blinded Finnhub overnight news as fadeable noise or justified repricing. Invalid model output fails closed.
3. Quorum: five-role deterministic adversarial desk weighs narrative, positioning, market intel, bear, and risk evidence.
4. Mandate: natural-language risk rules compile into hard vetoes.
5. Execution: sim broker for RWA stock paper evidence; Agent Hub path proven on BTCUSDT Demo paper trading.
6. Proof: Arena records are sealed into a sha256 hash chain and signed with Ed25519 over a Merkle root.

## Core Commands

```bash
npm run backtest         # AAPLUSDT deterministic always-fade baseline
npm run backtest:news    # cached Qwen gate-driven pilot + label baselines
npm run backtest:multi   # 20-symbol public Bitget RWA always-fade baseline
npm run alpha:certify    # walk-forward pilot artifact, not proof of live alpha
npm run paper:journal    # AAPLUSDT/NVDAUSDT stock paper journal, CSV + JSONL
npm run arena:cockpit    # public cockpit data, chain, and attestation
npm run rwa:check        # read-only public Bitget RWA market report
```

Optional live Qwen regeneration:

```bash
BITGET_QWEN_API_KEY=<your-key> npm run gate:audit
```

Credentials stay in environment variables or ignored local files. Do not paste keys into chat or commit them.

## Important Files

- [public/arena.html](public/arena.html) - judge cockpit with in-browser chain verification and tamper simulation.
- [public/arena-chain.jsonl](public/arena-chain.jsonl) - Arena-native tamper-evident records.
- [public/arena-attestation.json](public/arena-attestation.json) - Ed25519 attestation over the Arena Merkle root.
- [artifacts/stock-paper-journal.jsonl](artifacts/stock-paper-journal.jsonl) and [artifacts/stock-paper-journal.csv](artifacts/stock-paper-journal.csv) - Track 3 stock paper journal.
- [artifacts/paper-btc-smoke.jsonl](artifacts/paper-btc-smoke.jsonl) - Bitget Demo integration smoke, BTCUSDT only.

## Honest Limits

- No live on-exchange RWA stock fill is claimed.
- The positive walk-forward result is a positive pilot OOS over 16 trading days, not proven profitable alpha.
- The 20-symbol always-fade basket is negative; the point of GapGuard is abstention, risk control, and verifiable restraint.
- Live real-money trading remains blocked without explicit user approval, a licensed passport, isolated margin, a hard notional cap, and `--confirm-live`.

## License

MIT. See [LICENSE](LICENSE).
