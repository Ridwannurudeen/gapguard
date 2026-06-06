# GapGuard

A tokenization gap-risk trading agent for the **Bitget AI Base Camp Hackathon S1 — Track 3 (US Stock AI Trading)**.

## The problem (unique to tokenization)

Tokenized US stocks (xStocks) trade **24/7**, but the underlying US market is open only
~6.5h per weekday. Overnight, on weekends, and on holidays the token has **no underlying
price discovery** — it drifts on crypto-market liquidity and sentiment, then **snaps toward
fair value at the next US open**. GapGuard perceives that dislocation, trades the convergence
(and/or hedges gap risk on held positions) under a hard risk governor, and logs every
decision as a glass-box audit trail.

This maps directly to the three Track-3 scoring criteria: a real problem in the tokenization
scenario, verifiable backtest/sim records, and use of Bitget's US-stock data/tools.

## Architecture

| Module | Role | Status |
| --- | --- | --- |
| `src/marketClock.ts` | Classifies the US session (regular/pre/post/overnight/weekend/holiday); `underlyingOpen` gates the edge; computes the next open. | ✅ built + tested |
| `src/nyseCalendar2026.ts` | Verified 2026 NYSE equity calendar (10 full closures + 2 early closes). | ✅ built |
| `src/dislocation.ts` | Estimates token vs fair-value gap in volatility units → `rich`/`cheap`/`fair` + confidence. | ✅ built + tested |
| `src/proxyReturn.ts` | Blends 24/7 signals (futures/sector-ETF tokens) into an implied underlying return that lifts fair value during off-hours. | ✅ built + tested |
| `src/riskGovernor.ts` | The differentiator: sizes by confidence/vol under a tighter off-hours cap, realizes into the reopen, halts on drawdown. | ✅ built + tested |
| `src/glassbox.ts` | Append-only JSONL audit trail = the rubric's "verifiable usage record". | ✅ built |
| Perception layer | Agent Hub Skills (`macro-analyst`, `sentiment-analyst`, `news-briefing`, `technical-analysis`) feeding the dislocation proxy. | ⏳ needs Bitget API key |
| Backtest/execute | Bitget Playbook via `@bitget-ai/getagent-skill` → PnL / drawdown / Sharpe. | ⏳ needs Playbook API key (Telegram admin) |

## Tooling (verified)

- **Agent Hub** (`bgc` CLI + `bitget-mcp-server`) — crypto-only market data + 5 analysis Skills. Perception brain.
- **Bitget Playbook** (`@bitget-ai/getagent-skill@0.2.1`) — US-stock quant backtest/deploy engine, driven from Claude Code.

## Develop

```bash
npm install
npm test         # vitest — 20 tests
npm run typecheck
npm run demo     # replay a synthetic weekend-gap scenario end-to-end
```

`npm run demo` runs the full loop (clock → dislocation → risk governor → glass-box) over a
synthetic TSLAx weekend: the token drifts rich while the market is closed, GapGuard shorts the
convergence under the off-hours cap, then flattens at the Monday reopen as price snaps back.
It prints a decision table and writes the audit trail to `glassbox-demo.jsonl`.

## Open step 1 (the gate)

Get the **Playbook API key** from the hackathon Telegram admin, then probe whether historical
tokenized-stock data covers off-hours at usable resolution.
- **Green** → wire the perception layer + Playbook backtest into the modules above.
- **Red** → re-point the same engine to the macro-regime panel fallback (no rework).
