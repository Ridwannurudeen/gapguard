# GapGuard — Submission Pack

**Bitget AI Base Camp Hackathon S1 · Track 3 — US Stock AI Trading**

Submission window: **Jun 15 – Jun 25, 2026 (UTC+8)**. Submit a demo link **or** GitHub repo + the project description below; video optional (≤3 min). Include the dissemination thread link for the Best Community Communication Award.

---

## Project description (draft — cap is 200 words)

GapGuard is an autonomous gap-risk agent for tokenized US stocks. Tokenized equity products can trade or quote outside the underlying US market's ~6.5-hour regular session, depending on venue and instrument. When the underlying is closed, price discovery is weaker and holders or market makers can be exposed to token/fair-value dislocations before the next US open.

The loop. Perception: a market clock plus 24/7 proxy signals estimate the underlying's fair value while the market is closed; Bitget Agent Hub Skills can add macro, sentiment, news, and technical context. Decision: GapGuard measures the token's dislocation in volatility units and discounts weak proxy evidence. Execution & risk control: a governor sizes by confidence under a tighter off-hours cap, halts on drawdown, and flattens at the reopen. Each decision is written to a hash-chained JSONL audit trail.

Verification today: runnable simulated TSLAx replay, tamper-evident glass-box log, and a validated Bitget Playbook package on ordinary TSLA daily bars. Final proof target: Bitget-backed tokenized-stock/off-hours data before claiming live convergence performance.

---

## Demo-video script (≤3 min)

| Time      | Visual                                                                 | Narration                                                                                                                                                                                    |
| --------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0:00–0:20 | TSLAx weekend replay, US market "CLOSED" badge                         | "Tokenized stock products can expose traders to prices moving while the underlying market is closed. That mismatch is a gap-risk problem."                                                   |
| 0:20–0:50 | Chart: token drifts while underlying is closed, then reanchors at open | "GapGuard watches for token/fair-value dislocations and only acts when the gap is large enough and evidence is strong enough."                                                               |
| 0:50–1:40 | Terminal running `npm run demo`, decision table filling in             | "The agent classifies the session, estimates fair value from 24/7 proxies, discounts weak proxy evidence, and sizes through a governor that caps off-hours risk and flattens at the reopen." |
| 1:40–2:20 | Bitget Playbook package / backtest scene                               | "The Playbook package is validated on ordinary TSLA daily bars today. The next proof upgrade is Bitget-backed tokenized-stock or off-hours data."                                            |
| 2:20–2:50 | `glassbox-demo.jsonl` scrolling with `prevHash` and `hash` fields      | "Every decision is a hash-chained glass box: inputs, thesis, risk call, and linkage to the previous record."                                                                                 |
| 2:50–3:00 | GapGuard logo + tagline                                                | "GapGuard. Trading the gap that tokenization opened."                                                                                                                                        |

---

## Rubric coverage (Track 3)

| Criterion                                                               | How GapGuard meets it                                                                                                       | Status                    |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| Real problem in the US-stock tokenization scenario                      | Off-hours token/fair-value gap risk for tokenized-stock holders and market makers                                           | ✅ built                  |
| Verifiable backtesting or simulated trading records                     | `glassbox-demo.jsonl` from `npm run demo`, now hash-chained for tamper evidence                                             | ✅ sim log                |
| Uses Bitget US-stock data/tools                                         | Playbook package validates locally on ordinary TSLA daily bars; Agent Hub/Qwen hooks are wired but need keys for live proof | ⏳ needs Playbook/API key |
| Basic gate: real, workable demo; whose problem; verifiable usage record | Runnable `npm run demo`; problem = tokenized-stock holders/market-makers; record = hash-chained JSONL log                   | ✅ met                    |

> Note: the rubric accepts **any one** of real/simulated trading logs, API call volume, or user count. The simulated log satisfies the gate; Bitget-backed tokenized-stock/off-hours data would upgrade the proof and should be obtained before making performance claims.

---

## Pre-submission checklist

- [ ] Pin exact target instrument/venue and supported trading hours
- [ ] Playbook API key obtained (Telegram admin + UID) → probe tokenized-stock/off-hours data first, then capture PnL/drawdown/Sharpe if available
- [ ] Replace the Playbook scene in the video with real numbers, or label it as ordinary-equity baseline
- [ ] Record ≤3-min demo video
- [ ] Publish #BitgetHackathon dissemination thread (tag Bitget AI), keep the link
- [ ] Decide submission artifact: GitHub repo link (repo is currently private — make public or grant judge access)
- [ ] Submit via the official link released Jun 15 (do **not** submit without explicit approval)
