# GapGuard — Submission Pack

**Bitget AI Base Camp Hackathon S1 · Track 3 — US Stock AI Trading**

Submission window: **Jun 15 – Jun 25, 2026 (UTC+8)**. Submit a demo link **or** GitHub repo + the project description below; video optional (≤3 min). Include the dissemination thread link for the Best Community Communication Award.

---

## Project description (175 words — cap is 200)

GapGuard is an autonomous agent that trades a price dislocation unique to tokenized US stocks. Tokenized equities (xStocks) trade 24/7, but the underlying US market is open only ~6.5 hours per weekday. Overnight, on weekends, and on holidays the token has no underlying price discovery — it drifts on crypto-market sentiment, then snaps toward fair value at the next US open. That gap is a real risk for anyone holding or making markets in tokenized US stocks.

The loop. Perception: a market-clock plus Bitget Agent Hub Skills (macro-analyst, sentiment-analyst, news-briefing, technical-analysis) and 24/7 proxy signals (index futures, sector-ETF tokens) estimate the underlying's fair value while the market is closed. Decision: GapGuard measures the token's dislocation in volatility units and trades the convergence. Execution & risk control: a risk governor sizes by confidence under a tighter off-hours cap, halts on a drawdown breaker, and flattens at the reopen — every decision logged as a glass-box audit trail.

Verification: backtested on historical tokenized-stock data via Bitget Playbook (PnL, max drawdown, Sharpe). Bitget tools used: Agent Hub Skills and Playbook.

---

## Demo-video script (≤3 min)

| Time | Visual | Narration |
| --- | --- | --- |
| 0:00–0:20 | TSLAx ticking on a weekend, US market "CLOSED" badge | "Tokenized US stocks trade 24/7. The real market doesn't. That mismatch creates a gap no one's trading — yet." |
| 0:20–0:50 | Chart: token drifts up over the weekend, snaps down at Monday open | "With no underlying price discovery, the token drifts on crypto sentiment overnight — then snaps to fair value at the open. That's GapGuard's edge." |
| 0:50–1:40 | Terminal running `npm run demo`, decision table filling in | "GapGuard perceives the session, estimates fair value from Bitget Agent Hub Skills and 24/7 proxies, measures the dislocation in volatility units, and shorts the convergence — under a risk governor that caps off-hours size and flattens at the reopen." |
| 1:40–2:20 | Bitget Playbook backtest: PnL / drawdown / Sharpe | "Backtested on historical tokenized-stock data in Bitget Playbook — here's the PnL, max drawdown, and Sharpe." |
| 2:20–2:50 | `glassbox-demo.jsonl` scrolling | "Every decision is a glass box — inputs, thesis, and risk call, logged and auditable. Not a black box." |
| 2:50–3:00 | GapGuard logo + tagline | "GapGuard. Trading the gap that tokenization opened." |

---

## Rubric coverage (Track 3)

| Criterion | How GapGuard meets it | Status |
| --- | --- | --- |
| Real problem in the US-stock tokenization scenario | 24/7-token vs ~6.5h-market gap risk — exists *only* because the asset is tokenized | ✅ built |
| Verifiable backtesting or simulated trading records | `glassbox-demo.jsonl` (simulated trading log via `npm run demo`) + Playbook backtest | ✅ sim log / ⏳ Playbook |
| Uses Bitget US-stock data/tools | Agent Hub Skills (macro/sentiment/news/technical) + Bitget Playbook backtest | ⏳ needs Playbook key |
| Basic gate: real, workable demo; whose problem; verifiable usage record | Runnable `npm run demo`; problem = tokenized-stock holders/market-makers; record = JSONL log | ✅ met |

> Note: the rubric accepts **any one** of real/simulated trading logs, API call volume, or user count. The simulated log already satisfies the gate; the Playbook backtest upgrades it and satisfies the separate "uses Bitget tools" criterion.

---

## Pre-submission checklist

- [ ] Playbook API key obtained (Telegram admin + UID) → run backtest, capture PnL/drawdown/Sharpe
- [ ] Replace the Playbook scene in the video with real numbers
- [ ] Record ≤3-min demo video
- [ ] Publish #BitgetHackathon dissemination thread (tag Bitget AI), keep the link
- [ ] Decide submission artifact: GitHub repo link (repo is currently private — make public or grant judge access)
- [ ] Submit via the official link released Jun 15 (do **not** submit without explicit approval)
