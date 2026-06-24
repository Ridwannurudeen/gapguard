# GapGuard - Submission Pack

Bitget AI Base Camp Hackathon S1, Track 3: US Stock AI Trading.

Submission requires explicit user approval before any form, deploy, publish, or PR merge action.

## Project Description

GapGuard is an AI abstention and risk engine for tokenized US stocks: it decides whether an off-hours gap is liquidity noise to trade or news-driven repricing to respect, then proves every decision with a signed audit trail.

Tokenized US stocks on Bitget, such as `AAPLUSDT` and `NVDAUSDT`, trade 24/7 while the underlying US market has a regular weekday session. Off-hours gaps can be liquidity noise, but they can also be real repricing from news or macro catalysts. GapGuard's edge is not blindly fading every gap. The product is the decision boundary: trade only when the evidence says noise, stand aside when evidence says news, size under a mandate, and leave a receipt.

## System

- Perception: read-only Bitget RWA futures contract/ticker data, US-session clock, spread/funding/min-size checks, and deterministic dislocation estimates.
- Catalyst gate: Qwen catalyst gate over real, blinded Finnhub news. Invalid or malformed model output fails closed to stand aside.
- Decision: Quorum, a five-role deterministic adversarial desk, converts role evidence into a position multiplier and veto state.
- Risk: a natural-language mandate compiles to hard vetoes for drawdown, position size, and conflicting evidence.
- Execution: deterministic RWA sim broker for stock paper evidence; Bitget Agent Hub path proven separately with BTCUSDT Demo paper trading.
- Trust: signed tamper-evident audit trail inspired by regulated-market recordkeeping. This is a cryptographic integrity proof, not regulatory certification.

## Evidence

All public numbers below are generated from committed artifacts by `npm run evidence`. Full traceability lives in `docs/METRICS.md` and `public/metrics.json`.

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

The 2026-06-09 WWDC case is the hero example: the Qwen catalyst gate correctly stood aside on a news-driven repricing gap that the always-fade baseline would have traded.

## Track 3 Materials

| Required material | Provided artifact |
| --- | --- |
| Public GitHub repo + README | Repo README with install, quickstart, and evidence links |
| Login-free demo | `public/arena.html` with browser chain verification and tamper toggle |
| Paper trading log | `artifacts/stock-paper-journal.jsonl` and `artifacts/stock-paper-journal.csv` for AAPLUSDT/NVDAUSDT stock paper rows |
| Backtest report | `artifacts/aaplusdt-backtest.json`, `artifacts/aaplusdt-news-aware-backtest.json`, `artifacts/rwa-multi-backtest.json`, `artifacts/rwa-alpha-certification.json`, and `playbook/aaplusdt-backtest-result.json` |
| Exchange integration evidence | `artifacts/paper-btc-smoke.jsonl`, explicitly labeled as Bitget Demo crypto integration smoke |

## Reproduce

```bash
npm install
npm run judge
npm run typecheck
npm test
npm run evidence:check
```

Optional live Qwen audit regeneration:

```bash
BITGET_QWEN_API_KEY=<your-key> npm run gate:audit
```

## Demo Script

| Time | Visual | Narration |
| --- | --- | --- |
| 0:00-0:20 | `public/arena.html` hero | "GapGuard decides whether a tokenized-stock gap is noise to trade or news to respect." |
| 0:20-0:50 | WWDC gate case | "On the WWDC gap, the Qwen catalyst gate stood aside instead of blindly fading the move." |
| 0:50-1:20 | Quorum desk | "The five-role deterministic adversarial desk turns evidence and dissent into a size or veto." |
| 1:20-1:50 | Naive bot rejected | "The naive bot breaches the mandate and is barred from capital." |
| 1:50-2:20 | Chain verify + tamper | "The browser recomputes every hash. One changed row turns the chain red." |
| 2:20-3:00 | Evidence boundary | "Stock evidence is backtest/paper; BTCUSDT Demo proves the exchange path. Live RWA capital remains approval-gated." |

## Honest Limitations

1. No live on-exchange RWA stock fill is claimed. Bitget Demo supports crypto perps; the RWA stock leg is simulated/backtested unless explicit live approval is granted.
2. Proven profitable alpha is not claimed. The positive result is a positive pilot OOS over 16 trading days.
3. The broader always-fade basket is negative. This strengthens the product thesis: GapGuard blocks weak strategies instead of pretending every gap should be traded.
4. Qwen verdicts are cached for reproducibility after the live audit pass.

## Pre-Submission Checklist

- [x] Public repo and runnable README
- [x] Login-free cockpit with in-browser chain verification
- [x] Stock paper journal with Track 3 fields
- [x] Read-only public RWA market evidence
- [x] Tests and typecheck
- [ ] Demo video recorded by user
- [ ] Submit only after explicit user approval
