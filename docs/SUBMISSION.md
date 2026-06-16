# GapGuard — Submission Pack

**Bitget AI Base Camp Hackathon S1 · Track 3 — US Stock AI Trading**

Submission window: **Jun 15 – Jun 25, 2026 (UTC+8)**. Submit a demo link **or** GitHub repo + the project description below; video optional (≤3 min). Include the dissemination thread link for the Best Community Communication Award.

---

## Project description (draft — cap is 200 words)

GapGuard is an autonomous gap-risk agent for tokenized US stocks. Tokenized equity products can trade or quote outside the underlying US market's ~6.5-hour regular session, depending on venue and instrument. When the underlying is closed, price discovery is weaker and holders or market makers can be exposed to token/fair-value dislocations before the next US open.

The loop. Perception: a market clock plus 24/7 proxy signals estimate the underlying's fair value while the market is closed; Bitget Agent Hub Skills can add macro, sentiment, news, and technical context. Decision: GapGuard measures the token's dislocation in volatility units and discounts weak proxy evidence. Execution & risk control: a governor sizes by confidence under a tighter off-hours cap, halts on drawdown, and flattens at the reopen. Each decision is written to a hash-chained JSONL audit trail.

Verification today: runnable simulated TSLAx replay, hash-chain verifier, judge dashboard, Bitget Wallet API probe report, and a validated Bitget Playbook package on ordinary TSLA daily bars. Final proof target: authenticated Bitget tokenized-stock/off-hours data before claiming live convergence performance.

---

## Demo-video script (≤3 min)

| Time      | Visual                                                                 | Narration                                                                                                                                                               |
| --------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0:00–0:20 | TSLAx weekend replay, US market "CLOSED" badge                         | "Tokenized stock products can expose traders to prices moving while the underlying market is closed. That mismatch is a gap-risk problem."                              |
| 0:20–0:50 | Chart: token drifts while underlying is closed, then reanchors at open | "GapGuard watches for token/fair-value dislocations and only acts when the gap is large enough and evidence is strong enough."                                          |
| 0:50–1:30 | Terminal running `npm run replay:proof` and `npm run verify-log`       | "The agent classifies the session, estimates fair value from 24/7 proxies, discounts weak proxy evidence, sizes through a governor, and emits a verifiable hash chain." |
| 1:30–2:10 | `public/dashboard.html` proof cockpit                                  | "The dashboard shows token price, fair value, proxy confidence, action, and final hash from the same replay records."                                                   |
| 2:10–2:35 | `data/bitget-probe-report.json`                                        | "The Bitget Wallet probe is built and reaches the production host; this run is blocked only because API credentials are missing."                                       |
| 2:35–2:55 | Bitget Playbook package / backtest scene                               | "The Playbook package is labeled as an ordinary-equity baseline. It is not presented as tokenized-stock performance proof."                                             |
| 2:55–3:00 | GapGuard logo + tagline                                                | "GapGuard. Risk control for the gap tokenization opened."                                                                                                               |

---

## Rubric coverage (Track 3)

| Criterion                                                               | How GapGuard meets it                                                                                                         | Status           |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| Real problem in the US-stock tokenization scenario                      | Off-hours token/fair-value gap risk for tokenized-stock holders and market makers                                             | ✅ built         |
| Verifiable backtesting or simulated trading records                     | `glassbox-demo.jsonl` from `npm run replay:proof`, verified by `npm run verify-log`                                           | ✅ sim log       |
| Uses Bitget US-stock data/tools                                         | Bitget Wallet API signer/probe built; Playbook validates locally on ordinary TSLA daily bars; live tokenized proof needs keys | ⏳ needs API key |
| Basic gate: real, workable demo; whose problem; verifiable usage record | Runnable replay, dashboard, verifier, and probe report; problem = tokenized-stock holders/market-makers                       | ✅ met           |

> Note: the rubric accepts **any one** of real/simulated trading logs, API call volume, or user count. The simulated log satisfies the gate; Bitget-backed tokenized-stock/off-hours data would upgrade the proof and should be obtained before making performance claims.

---

## Executable proof commands

```bash
npm run replay:proof
npm run verify-log
npm run probe:bitget
```

Current generated artifacts:

- `glassbox-demo.jsonl` — local ignored JSONL audit trail
- `public/dashboard-data.json` — dashboard data generated from the replay
- `public/dashboard.html` — static proof cockpit
- `data/bitget-probe-report.json` — live Bitget Wallet API probe result
- `docs/PROOF.md` — API source notes and proof scope

---

## Pre-submission checklist

- [x] Build proof replay, hash-chain verifier, dashboard, and Bitget API probe
- [ ] Obtain Bitget Wallet API credentials and rerun `npm run probe:bitget`
- [ ] Pin exact target instrument/venue and supported trading hours from authenticated Bitget response
- [ ] If authenticated data is available, replace the synthetic replay with real tokenized-stock/off-hours records
- [ ] Keep the Playbook scene labeled as ordinary-equity baseline unless tokenized-stock data is added
- [ ] Record ≤3-min demo video
- [ ] Publish #BitgetHackathon dissemination thread (tag Bitget AI), keep the link
- [ ] Decide submission artifact: GitHub repo link (repo is currently private — make public or grant judge access)
- [ ] Submit via the official link released Jun 15 (do **not** submit without explicit approval)
