# GapGuard - Submission Pack

Bitget AI Base Camp Hackathon S1, Track 3: US Stock AI Trading.

Submission requires explicit user approval before any form, deploy, publish, or PR merge action.

## Project Description

GapGuard is an AI abstention and risk engine for tokenized US stocks: it decides whether an off-hours gap is liquidity noise to trade or news-driven repricing to respect, then proves every decision with a signed audit trail.

Tokenized US stocks on Bitget, such as `AAPLUSDT` and `NVDAUSDT`, trade 24/7 while the underlying US market has a regular weekday session. Off-hours gaps can be liquidity noise, but they can also be real repricing from news or macro catalysts. GapGuard's edge is not blindly fading every gap. The product is the decision boundary: trade only when the evidence says noise, stand aside when evidence says news, size under a mandate, and leave a receipt.

For an ordinary trader, that boundary ships as a **non-custodial advisory assistant** (`public/app.html`): plain-English live gap calls, AI fadeable/stand-aside verdicts, an editable personal risk mandate, and a one-tap handoff to the trader's own Bitget account. GapGuard never holds keys or places orders — it gives the call, shows the exact order, and the trader acts on their own exchange. This is the "solve a real problem around the US stock trading experience" half of Track 3: most tools tell you when to buy; GapGuard tells a normal person when *not* to trade, with the reasoning and their own guardrails.

## System

- Perception: read-only Bitget RWA futures contract/ticker data, US-session clock, spread/funding/min-size checks, and deterministic dislocation estimates.
- Catalyst gate: Qwen catalyst gate over real, blinded Finnhub news. Invalid or malformed model output fails closed to stand aside.
- Decision: Quorum, a five-role deterministic adversarial desk, converts role evidence into a position multiplier and veto state.
- Risk: a natural-language mandate compiles to hard vetoes for drawdown, position size, and conflicting evidence.
- Execution: deterministic RWA sim broker for stock paper evidence; Bitget Agent Hub path proven separately with BTCUSDT Demo paper trading.
- Trust: signed tamper-evident audit trail inspired by regulated-market recordkeeping. This is a cryptographic integrity proof, not regulatory certification.
- Assistant: a non-custodial consumer front-end (`public/app.html`) — live off-hours gap cards from real Bitget index-vs-last data, AI fadeable/stand-aside verdicts, an editable plain-English risk mandate stored in the browser, and a one-tap handoff to the trader's own Bitget pair. No keys in the browser; GapGuard never places the order.

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
| Risk-reduction edge: worst-case (p95) regret, gate vs always-fade | 5.807% vs 7.474% (reduction p=0.001) | `artifacts/gate-holdout-report.json` |
| Stock paper journal | 58 rows | `artifacts/stock-paper-journal.jsonl`, `artifacts/stock-paper-journal.csv` |
| Crypto Demo integration smoke | 3 BTCUSDT paper rows | `artifacts/paper-btc-smoke.jsonl` |
| Live AAPLUSDT round-trip (real funds) | open @ 315.47, close @ 315.16, size 0.05, balance -$0.034 | `artifacts/live-trades.jsonl` |
<!-- EVIDENCE:END -->

The 2026-06-09 WWDC case is the hero example: the Qwen catalyst gate correctly stood aside on a news-driven repricing gap that the always-fade baseline would have traded.

**Where the edge actually is (measured, significance-tested).** Judged on raw direction accuracy, the gate does *not* beat fading everything (39.0% vs 42.2%) — and we say so. But accuracy is the wrong objective for an abstention engine: a fade-everything bot looks accurate precisely because most gaps revert, while it eats the catastrophic losses on the news days. On the metric that matters — **worst-case (95th-percentile) regret** — the gate cuts the tail loss from **7.47% to 5.81%**, a reduction with 95% CI [1.23%, 3.56%] and **p = 0.001** on the 20-symbol / 790-candidate holdout. So the proven edge is **risk reduction, not direction-picking**: the gate trades ~3pp of average accuracy to significantly avoid the disasters. That is exactly what "knows when not to trade" should buy, and the holdout proves the trade is real.

## Track 3 Materials

| Official Track 3 requirement | Provided |
| --- | --- |
| Project description (four-part, clear thesis) | This doc + `README.md` — problem, system, evidence, honest limits |
| Public GitHub repo + README, **or** login-free demo | Both: public repo with a runnable README, **and** login-free demos — `public/app.html` (consumer assistant) and `public/arena.html` (cockpit with browser chain verification) |
| Project demo video | **https://youtu.be/e_KX0ZDN2uw** — ~3-min walkthrough: WWDC stand-aside, the p=0.001 risk-reduction edge, the consumer one-tap handoff, and live browser chain verification |
| Live/paper trading log: timestamp · asset · direction · price · quantity · balance change | `artifacts/stock-paper-journal.jsonl` / `.csv` — all six required fields, AAPLUSDT, plus PnL and a naive counterfactual |
| Backtest report **with code** (not screenshots) | `artifacts/aaplusdt-backtest.json`, `aaplusdt-news-aware-backtest.json`, `rwa-multi-backtest.json`, `rwa-alpha-certification.json`, `playbook/aaplusdt-backtest-result.json` — all reproducible via `npm run backtest*` / `alpha:certify`, code in `src/` |
| Exchange integration (supplementary) | `artifacts/paper-btc-smoke.jsonl` — Bitget Demo crypto integration smoke; the AAPLUSDT managed Playbook backtest also completed |

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
| 0:00-0:25 | `public/app.html` — a live gap call | "GapGuard reads the overnight gap on a tokenized US stock and tells an ordinary trader, in plain English, whether to fade it or stand aside." |
| 0:25-0:50 | app.html — a Stand-aside call + the recorded WWDC row | "Its edge is knowing when *not* to trade — like the day it stood aside before the WWDC repricing, avoiding a 1.97% loss." |
| 0:50-1:15 | app.html — My Rules + the one-tap Bitget handoff | "You set your own risk rules; GapGuard shows the exact order — fade equals sell or buy — and hands off to your own Bitget. It never holds your keys or places the trade." |
| 1:15-1:45 | `public/arena.html` — Quorum desk + Verify chain | "Under the hood, a five-role deterministic desk turns evidence and dissent into a size or veto, and every decision is signed — your browser recomputes every hash." |
| 1:45-2:15 | arena.html — Simulate tampering | "Change one row and the chain turns red. Tamper-evident, browser-verifiable." |
| 2:15-3:00 | Operator console (brief) + evidence boundary | "The same engine also executes autonomously under hard risk gates, keys server-side. Stock evidence is backtest/paper; the BTCUSDT Demo fill proves the exchange path; live RWA capital stays approval-gated." |

## Honest Limitations

1. One real live on-exchange RWA stock fill has been executed and closed (AAPLUSDT, `artifacts/live-trades.jsonl`) under explicit live approval; it proves the exchange path end-to-end and is not a live-alpha or sustained-trading claim. Bitget Demo supports crypto perps only, so the RWA stock leg otherwise stays simulated/backtested.
2. No directional alpha is claimed: on raw accuracy the gate does not beat fading everything (39.0% vs 42.2%). The proven, significance-tested edge is risk reduction — a worst-case (p95) regret cut of 7.47% to 5.81% (p = 0.001), not profit. The small positive pilot (+1.4% OOS, 13 trades) is illustrative, not a generalized profit claim.
3. The broader always-fade basket is negative. This strengthens the product thesis: GapGuard blocks weak strategies instead of pretending every gap should be traded.
4. Qwen verdicts are cached for reproducibility after the live audit pass.

## Pre-Submission Checklist

- [x] Public repo and runnable README
- [x] Login-free cockpit with in-browser chain verification
- [x] Stock paper journal with Track 3 fields
- [x] Read-only public RWA market evidence
- [x] Tests and typecheck
- [x] Demo video: https://youtu.be/e_KX0ZDN2uw
- [ ] Submit only after explicit user approval
