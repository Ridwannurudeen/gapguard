# GapGuard

A tokenization gap-risk control tower for the **Bitget AI Base Camp Hackathon S1 — Track 3 (US Stock AI Trading)**.

## The problem (unique to tokenization)

Tokenized US stock products can expose holders to trading or pricing outside the underlying
US market's ~6.5h weekday regular session, with exact hours depending on the venue and
instrument. During pre-market, post-market, weekend, and holiday windows, the token can move
without live underlying price discovery. GapGuard treats that mismatch as a gap-risk control
problem: estimate fair value from 24/7 proxies, stand down when evidence is weak or news
justifies repricing, size under a hard risk governor, and log every decision in a hash-chained
glass-box audit trail.

This maps directly to the three Track-3 scoring criteria: a real problem in the tokenization
scenario, replayable simulated records, and a path to Bitget's US-stock data/tools.

## Architecture

| Module                                   | Role                                                                                                                                                              | Status                                                                    |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `src/marketClock.ts`                     | Classifies the US session (regular/pre/post/overnight/weekend/holiday); `underlyingOpen` gates the edge; computes the next open.                                  | ✅ built + tested                                                         |
| `src/nyseCalendar2026.ts`                | Verified 2026 NYSE equity calendar (10 full closures + 2 early closes).                                                                                           | ✅ built                                                                  |
| `src/dislocation.ts`                     | Estimates token vs fair-value gap in volatility units → `rich`/`cheap`/`fair` + confidence.                                                                       | ✅ built + tested                                                         |
| `src/proxyReturn.ts`                     | Blends 24/7 signals (futures/sector-ETF tokens) into an implied underlying return; weak proxy confidence now discounts the fair-value shift.                      | ✅ built + tested                                                         |
| `src/riskGovernor.ts`                    | The differentiator: sizes by confidence/vol under a tighter off-hours cap, realizes into the reopen, halts on drawdown.                                           | ✅ built + tested                                                         |
| `src/glassbox.ts`                        | Hash-chained JSONL audit trail for tamper-evident simulated decision records.                                                                                     | ✅ built + tested                                                         |
| `src/convergenceGate.ts` + `src/qwen.ts` | LLM gate (Qwen): classifies an off-hours gap as fadeable noise vs justified repricing, so the agent never fades real overnight news.                              | ✅ built + tested                                                         |
| `src/bitgetWalletApi.ts`                 | Bitget Wallet API signer/client using the official `x-api-key`, `x-api-timestamp`, `x-api-signature` HMAC flow.                                                   | ✅ built + tested                                                         |
| `src/bitgetProbe.ts`                     | Executable target-market probe for token info, K-lines, transaction info, and optional RWA quote routing.                                                         | ✅ built · blocked without API key                                        |
| `public/dashboard.html`                  | Static judge cockpit for replay outcome, proxy confidence, risk actions, and hash-chain verification.                                                             | ✅ built                                                                  |
| Perception layer                         | Agent Hub Skills (`macro-analyst`, `sentiment-analyst`, `news-briefing`, `technical-analysis`) feeding the dislocation proxy + gate news context.                 | ⏳ needs Bitget API key                                                   |
| `playbook/`                              | Bitget Playbook package (Python/Nautilus): overnight-gap reversion on ordinary US-equity daily bars. This is a validated baseline, not tokenized-stock proof yet. | ✅ authored + validation PASSED · ⏳ cloud run blocked on key↔UID binding |

## Tooling (verified)

- **Agent Hub** (`bgc` CLI + `bitget-mcp-server`) — crypto-only market data + 5 analysis Skills. Perception brain.
- **Bitget Playbook** (`@bitget-ai/getagent-skill@0.2.1`) — US-stock quant backtest/deploy engine; local package validation passed, cloud run still pending key/UID access.

## Develop

```bash
npm install
npm test         # vitest — 42 tests
npm run typecheck
npm run demo       # replay data/tslax-replay.json and write glassbox-demo.jsonl + public/dashboard-data.json
npm run verify-log # verify the hash chain in glassbox-demo.jsonl
npm run probe:bitget

# LLM convergence gate (Qwen). Needs the Bitget hackathon Qwen subsidy key:
BITGET_QWEN_API_KEY=<your-key> npm run gate-demo
```

`npm run demo` runs the full loop (clock → dislocation → proxy-confidence discount → risk
governor → hash-chained glass-box) over `data/tslax-replay.json`. It writes:

- `glassbox-demo.jsonl` — ignored local audit log
- `public/dashboard-data.json` — static dashboard data
- `public/dashboard.html` — judge-facing cockpit

`npm run probe:bitget` writes `data/bitget-probe-report.json`. Without
`BITGET_WALLET_API_KEY` and `BITGET_WALLET_API_SECRET`, the report records the live blocker
(`missing header x-api-key`) and keeps the proof status at `blocked_missing_credentials`.

## Open step 1 (the gate)

Get the Bitget Wallet API credentials and rerun:

```bash
BITGET_WALLET_API_KEY=<key> BITGET_WALLET_API_SECRET=<secret> npm run probe:bitget
```

- **Green** → use returned K-lines/quote metadata as the source for a real Bitget replay.
- **Red** → submit as a risk-control/simulation demo and clearly label the ordinary-equity
  Playbook as a baseline, not proof of tokenized-stock convergence.
