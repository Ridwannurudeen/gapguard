# GapGuard — Submission Pack

**Bitget AI Base Camp Hackathon S1 · Track 3 — US Stock AI Trading**

Submission window: **Jun 15 – Jun 25, 2026 (UTC+8)**. Submit a demo link **or** GitHub repo + the project description below; video optional (≤3 min). Include the dissemination thread link for the Best Community Communication Award.

---

## Project description (197 words — cap is 200)

GapGuard is a gap-risk control tower for tokenized US stocks. xStocks trade 24/7, but the underlying market is open only ~6.5 hours per weekday. Overnight, on weekends, and on holidays the token has no price discovery — it drifts on crypto sentiment, then snaps toward fair value at the next US open. That gap is a real risk for anyone holding or making markets in them.

The loop. Perception: a market-clock plus 24/7 proxy signals (index futures, sector-ETF tokens) estimate fair value while the market is closed, and an LLM convergence gate reads off-hours news to separate fadeable noise from justified repricing. Decision: GapGuard measures the dislocation in volatility units and chooses to hedge, reduce, fade the convergence, or stand down — only when the gate clears the fade. Execution & risk control: a risk governor sizes by confidence under a tighter off-hours cap, halts on a drawdown breaker and flattens at reopen — every decision logged as a glass-box audit trail.

Verification: the reversion core is backtested in Bitget Playbook on real TSLA daily bars — Sharpe 1.96, 75% win rate over 40 trades, 3.48 profit factor. A glass-box log (`npm run demo`) records every live decision. Bitget tool: Playbook.

---

## Demo-video script (≤3 min)

| Time | Visual | Narration |
| --- | --- | --- |
| 0:00–0:20 | TSLAx ticking on a weekend, US market "CLOSED" badge | "Tokenized US stocks trade 24/7. The real market doesn't. That mismatch creates a gap no one's trading — yet." |
| 0:20–0:50 | Chart: token drifts up over the weekend, snaps down at Monday open | "With no underlying price discovery, the token drifts on crypto sentiment overnight — then snaps to fair value at the open. That's GapGuard's edge." |
| 0:50–1:40 | Terminal running `npm run demo`, decision table filling in | "GapGuard perceives the session, estimates fair value from 24/7 proxy signals and a Qwen convergence gate, measures the dislocation in volatility units, and fades the convergence — under a risk governor that caps off-hours size, charges fees and slippage, and flattens at the reopen." |
| 1:40–2:20 | Bitget Playbook run: TSLA backtest metrics on screen | "The reversion core is backtested in Bitget Playbook on real TSLA bars — Sharpe 1.96, 75% win rate over 40 trades, profit factor 3.48." |
| 2:20–2:50 | `glassbox-demo.jsonl` scrolling, `chain verified ✓` on screen | "Every decision is a glass box — inputs, thesis, and risk call, logged in a sha256 hash chain. Alter any past record and verification fails. Not a black box, and tamper-evident." |
| 2:50–3:00 | GapGuard logo + tagline | "GapGuard. Trading the gap that tokenization opened." |

---

## Rubric coverage (Track 3)

| Criterion | How GapGuard meets it | Status |
| --- | --- | --- |
| Real problem in the US-stock tokenization scenario | 24/7-token vs ~6.5h-market gap risk — exists *only* because the asset is tokenized | ✅ built |
| Verifiable backtesting or simulated trading records | `glassbox-demo.jsonl` — a **tamper-evident** sha256 hash-chained simulated trading log (`npm run demo`, `verifyChain()`) + real TSLA Playbook backtest logged in GetAgent cloud | ✅ both |
| Uses Bitget US-stock data/tools | Bitget Playbook — package uploaded, backtest run on real TSLA daily bars (Sharpe 1.96 / 75% win / 40 trades / PF 3.48); execution router built on Bitget's real instrument model (spot-only xStocks → USDT-M stock perp `TSLAUSDT` for shorts) | ✅ proven |
| Basic gate: real, workable demo; whose problem; verifiable usage record | Runnable `npm run demo`; problem = tokenized-stock holders/market-makers; record = JSONL log | ✅ met |

> Note: the rubric accepts **any one** of real/simulated trading logs, API call volume, or user count. The simulated log already satisfies the gate; the Playbook backtest upgrades it and satisfies the separate "uses Bitget tools" criterion.

---

## Pre-submission checklist

- [x] Playbook ACCESS-KEY obtained via GetAgent UI → backtest run, real TSLA metrics captured (Sharpe 1.96 / 75% win / 40 trades / PF 3.48)
- [ ] Record ≤3-min demo video (Playbook scene uses the real numbers above)
- [ ] Publish #BitgetHackathon dissemination thread (tag Bitget AI), keep the link
- [ ] Decide submission artifact: GitHub repo link (repo is currently private — make public or grant judge access)
- [ ] Submit via the official link released Jun 15 (do **not** submit without explicit approval)
